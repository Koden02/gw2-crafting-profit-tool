from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Query, Session

from app.db.session import DATABASE_PATH
from app.models.app_setting import AppSetting
from app.models.commerce_price import CommercePrice
from app.models.ignored_price_item import IgnoredPriceItem
from app.models.item import Item
from app.models.price_history import CommercePriceRollup, CommercePriceSnapshot
from app.models.recipe import Recipe
from app.models.recipe_ingredient import RecipeIngredient

SnapshotItemMode = Literal["relevant", "all"]
RelevanceFilter = Literal["all", "relevant", "ignored", "untracked"]

SNAPSHOT_ROW_ESTIMATED_BYTES = 180
ROLLUP_ROW_ESTIMATED_BYTES = 220
BYTES_PER_MEGABYTE = 1024 * 1024

DEFAULT_CONFIG: dict[str, int | bool | str] = {
	"auto_price_sync_enabled": True,
	"price_sync_interval_minutes": 15,
	"raw_snapshot_retention_days": 14,
	"hourly_rollup_retention_days": 90,
	"daily_rollup_retention_days": 365,
	"max_history_mb": 5120,
	"snapshot_item_mode": "relevant",
}

CONFIG_LIMITS: dict[str, tuple[int, int]] = {
	"price_sync_interval_minutes": (2, 1440),
	"raw_snapshot_retention_days": (1, 365),
	"hourly_rollup_retention_days": (1, 1825),
	"daily_rollup_retention_days": (1, 3650),
	"max_history_mb": (128, 1024 * 1024),
}


def utc_now() -> datetime:
	return datetime.now(timezone.utc)


def normalize_datetime(value: datetime | None) -> datetime | None:
	if value is None:
		return None

	if value.tzinfo is None:
		return value.replace(tzinfo=timezone.utc)

	return value.astimezone(timezone.utc)


class PriceHistoryService:
	def __init__(self, db: Session) -> None:
		self.db = db

	def get_config(self) -> dict[str, int | bool | str]:
		config = DEFAULT_CONFIG.copy()
		settings = (
			self.db.query(AppSetting)
			.filter(AppSetting.key.in_(DEFAULT_CONFIG.keys()))
			.all()
		)

		for setting in settings:
			config[setting.key] = self._coerce_config_value(setting.key, setting.value)

		return config

	def update_config(self, values: dict[str, Any]) -> dict[str, int | bool | str]:
		config = self.get_config()
		now = utc_now()

		for key, value in values.items():
			if value is None:
				continue

			if key not in DEFAULT_CONFIG:
				continue

			next_value = self._validate_config_value(key, value)
			config[key] = next_value

			setting = self.db.get(AppSetting, key)
			if setting is None:
				setting = AppSetting(key=key, value="", updated_at=now)
				self.db.add(setting)

			setting.value = self._serialize_config_value(next_value)
			setting.updated_at = now

		self.db.commit()
		return config

	def record_snapshot_if_due(self) -> dict[str, Any]:
		config = self.get_config()
		latest_snapshot_at = normalize_datetime(
			self.db.query(func.max(CommercePriceSnapshot.observed_at)).scalar()
		)
		now = utc_now()
		interval = timedelta(minutes=int(config["price_sync_interval_minutes"]))

		if latest_snapshot_at is not None and now - latest_snapshot_at < interval:
			return {
				"status": "skipped",
				"reason": "snapshot interval has not elapsed",
				"snapshots_recorded": 0,
				"observed_at": latest_snapshot_at,
			}

		count = self.record_snapshot(config=config, observed_at=now)
		return {
			"status": "ok",
			"reason": None,
			"snapshots_recorded": count,
			"observed_at": now,
		}

	def record_snapshot(
		self,
		config: dict[str, int | bool | str] | None = None,
		observed_at: datetime | None = None,
	) -> int:
		config = config or self.get_config()
		observed_at = observed_at or utc_now()
		query = self._tracked_price_query(str(config["snapshot_item_mode"]))

		total_inserted = 0
		batch: list[dict[str, Any]] = []

		for price in query.yield_per(1000):
			batch.append(
				{
					"item_id": price.item_id,
					"observed_at": observed_at,
					"buy_price": price.buy_price,
					"buy_quantity": price.buy_quantity,
					"sell_price": price.sell_price,
					"sell_quantity": price.sell_quantity,
				}
			)

			if len(batch) >= 1000:
				self.db.bulk_insert_mappings(CommercePriceSnapshot, batch)
				total_inserted += len(batch)
				batch.clear()

		if batch:
			self.db.bulk_insert_mappings(CommercePriceSnapshot, batch)
			total_inserted += len(batch)

		self.db.commit()
		return total_inserted

	def prune_history(self) -> dict[str, int]:
		config = self.get_config()
		now = utc_now()
		raw_cutoff = now - timedelta(days=int(config["raw_snapshot_retention_days"]))
		hourly_cutoff = now - timedelta(days=int(config["hourly_rollup_retention_days"]))
		daily_cutoff = now - timedelta(days=int(config["daily_rollup_retention_days"]))

		hourly_rollups_written = self._roll_up_snapshots(
			bucket_type="hour",
			bucket_format="%Y-%m-%d %H:00:00",
			older_than=raw_cutoff,
			created_at=now,
		)
		daily_rollups_written = self._roll_up_snapshots(
			bucket_type="day",
			bucket_format="%Y-%m-%d 00:00:00",
			older_than=raw_cutoff,
			created_at=now,
		)
		raw_deleted = (
			self.db.query(CommercePriceSnapshot)
			.filter(CommercePriceSnapshot.observed_at < raw_cutoff)
			.delete(synchronize_session=False)
		)
		hourly_deleted = (
			self.db.query(CommercePriceRollup)
			.filter(
				CommercePriceRollup.bucket_type == "hour",
				CommercePriceRollup.bucket_start < hourly_cutoff,
			)
			.delete(synchronize_session=False)
		)
		daily_deleted = (
			self.db.query(CommercePriceRollup)
			.filter(
				CommercePriceRollup.bucket_type == "day",
				CommercePriceRollup.bucket_start < daily_cutoff,
			)
			.delete(synchronize_session=False)
		)
		self.db.commit()

		max_prune = self._prune_to_max_history_size(int(config["max_history_mb"]))

		return {
			"hourly_rollups_written": hourly_rollups_written,
			"daily_rollups_written": daily_rollups_written,
			"raw_snapshots_deleted": raw_deleted + max_prune["raw_snapshots_deleted"],
			"hourly_rollups_deleted": hourly_deleted + max_prune["hourly_rollups_deleted"],
			"daily_rollups_deleted": daily_deleted + max_prune["daily_rollups_deleted"],
		}

	def get_storage_estimate(self) -> dict[str, Any]:
		config = self.get_config()
		tracked_item_count = self.count_tracked_items(str(config["snapshot_item_mode"]))
		price_count = self.db.query(func.count(CommercePrice.item_id)).scalar() or 0
		relevant_count = self.count_relevant_price_items()
		ignored_count = self.db.query(func.count(IgnoredPriceItem.item_id)).scalar() or 0
		raw_snapshot_count = self.db.query(func.count()).select_from(CommercePriceSnapshot).scalar() or 0
		hourly_rollup_count = (
			self.db.query(func.count())
			.select_from(CommercePriceRollup)
			.filter(CommercePriceRollup.bucket_type == "hour")
			.scalar()
			or 0
		)
		daily_rollup_count = (
			self.db.query(func.count())
			.select_from(CommercePriceRollup)
			.filter(CommercePriceRollup.bucket_type == "day")
			.scalar()
			or 0
		)
		interval_minutes = int(config["price_sync_interval_minutes"])
		runs_per_day = 1440 / interval_minutes
		raw_rows_per_day = tracked_item_count * runs_per_day
		estimated_raw_mb_per_day = raw_rows_per_day * SNAPSHOT_ROW_ESTIMATED_BYTES / BYTES_PER_MEGABYTE
		estimated_raw_retention_mb = (
			estimated_raw_mb_per_day * int(config["raw_snapshot_retention_days"])
		)
		estimated_hourly_rollup_mb = (
			tracked_item_count
			* 24
			* int(config["hourly_rollup_retention_days"])
			* ROLLUP_ROW_ESTIMATED_BYTES
			/ BYTES_PER_MEGABYTE
		)
		estimated_daily_rollup_mb = (
			tracked_item_count
			* int(config["daily_rollup_retention_days"])
			* ROLLUP_ROW_ESTIMATED_BYTES
			/ BYTES_PER_MEGABYTE
		)
		current_history_estimated_mb = (
			(raw_snapshot_count * SNAPSHOT_ROW_ESTIMATED_BYTES)
			+ ((hourly_rollup_count + daily_rollup_count) * ROLLUP_ROW_ESTIMATED_BYTES)
		) / BYTES_PER_MEGABYTE
		database_file_mb = (
			DATABASE_PATH.stat().st_size / BYTES_PER_MEGABYTE
			if DATABASE_PATH.exists()
			else 0
		)

		return {
			"config": config,
			"price_count": price_count,
			"relevant_price_item_count": relevant_count,
			"ignored_item_count": ignored_count,
			"tracked_item_count": tracked_item_count,
			"runs_per_day": runs_per_day,
			"raw_rows_per_day": raw_rows_per_day,
			"estimated_raw_mb_per_day": estimated_raw_mb_per_day,
			"estimated_raw_retention_mb": estimated_raw_retention_mb,
			"estimated_hourly_rollup_mb": estimated_hourly_rollup_mb,
			"estimated_daily_rollup_mb": estimated_daily_rollup_mb,
			"estimated_total_retention_mb": (
				estimated_raw_retention_mb
				+ estimated_hourly_rollup_mb
				+ estimated_daily_rollup_mb
			),
			"current_raw_snapshot_count": raw_snapshot_count,
			"current_hourly_rollup_count": hourly_rollup_count,
			"current_daily_rollup_count": daily_rollup_count,
			"current_history_estimated_mb": current_history_estimated_mb,
			"database_file_mb": database_file_mb,
			"max_history_mb": int(config["max_history_mb"]),
			"snapshot_row_estimated_bytes": SNAPSHOT_ROW_ESTIMATED_BYTES,
			"rollup_row_estimated_bytes": ROLLUP_ROW_ESTIMATED_BYTES,
		}

	def list_item_relevance(
		self,
		search: str = "",
		relevance_filter: RelevanceFilter = "relevant",
		limit: int = 50,
		offset: int = 0,
	) -> dict[str, Any]:
		output_ids = self._craft_output_ids_subquery()
		ingredient_ids = self._ingredient_ids_subquery()
		config = self.get_config()

		query = (
			self.db.query(
				Item.id.label("item_id"),
				Item.name.label("name"),
				CommercePrice.item_id.label("price_item_id"),
				IgnoredPriceItem.item_id.label("ignored_item_id"),
				output_ids.c.item_id.label("output_item_id"),
				ingredient_ids.c.item_id.label("ingredient_item_id"),
			)
			.outerjoin(CommercePrice, CommercePrice.item_id == Item.id)
			.outerjoin(IgnoredPriceItem, IgnoredPriceItem.item_id == Item.id)
			.outerjoin(output_ids, output_ids.c.item_id == Item.id)
			.outerjoin(ingredient_ids, ingredient_ids.c.item_id == Item.id)
		)

		trimmed_search = search.strip()
		if trimmed_search:
			query = query.filter(Item.name.ilike(f"%{trimmed_search}%"))

		if relevance_filter == "relevant":
			query = query.filter(
				or_(
					output_ids.c.item_id.isnot(None),
					ingredient_ids.c.item_id.isnot(None),
				)
			)
		elif relevance_filter == "ignored":
			query = query.filter(IgnoredPriceItem.item_id.isnot(None))
		elif relevance_filter == "untracked":
			query = query.filter(
				output_ids.c.item_id.is_(None),
				ingredient_ids.c.item_id.is_(None),
				IgnoredPriceItem.item_id.is_(None),
			)

		total = query.count()
		rows = (
			query.order_by(IgnoredPriceItem.item_id.isnot(None).desc(), Item.name.asc())
			.offset(offset)
			.limit(limit)
			.all()
		)

		items = []
		for row in rows:
			is_output = row.output_item_id is not None
			is_ingredient = row.ingredient_item_id is not None
			is_relevant = is_output or is_ingredient
			is_ignored = row.ignored_item_id is not None
			has_price = row.price_item_id is not None
			reasons: list[str] = []

			if is_output:
				reasons.append("craft output")

			if is_ingredient:
				reasons.append("recipe ingredient")

			if not reasons:
				reasons.append("not used by synced recipes")

			items.append(
				{
					"item_id": row.item_id,
					"name": row.name,
					"has_price": has_price,
					"is_relevant": is_relevant,
					"is_ignored": is_ignored,
					"is_tracked": self._is_tracked_by_config(
						mode=str(config["snapshot_item_mode"]),
						has_price=has_price,
						is_relevant=is_relevant,
						is_ignored=is_ignored,
					),
					"reasons": reasons,
				}
			)

		return {
			"items": items,
			"total": total,
			"limit": limit,
			"offset": offset,
			"filter": relevance_filter,
			"search": search,
		}

	def ignore_item(self, item_id: int, reason: str | None = None) -> dict[str, Any]:
		item = self.db.get(Item, item_id)
		if item is None:
			return {"status": "not_found", "item_id": item_id}

		ignored = self.db.get(IgnoredPriceItem, item_id)
		if ignored is None:
			ignored = IgnoredPriceItem(item_id=item_id, created_at=utc_now())
			self.db.add(ignored)

		ignored.reason = reason
		self.db.commit()
		return {"status": "ok", "item_id": item_id, "ignored": True}

	def restore_item(self, item_id: int) -> dict[str, Any]:
		ignored = self.db.get(IgnoredPriceItem, item_id)
		if ignored is not None:
			self.db.delete(ignored)
			self.db.commit()

		return {"status": "ok", "item_id": item_id, "ignored": False}

	def count_tracked_items(self, mode: str) -> int:
		query = self._tracked_price_query(mode)
		return query.count()

	def count_relevant_price_items(self) -> int:
		relevant_ids = self._relevant_item_ids_subquery()
		return (
			self.db.query(func.count(CommercePrice.item_id))
			.join(relevant_ids, relevant_ids.c.item_id == CommercePrice.item_id)
			.scalar()
			or 0
		)

	def latest_price_sync_at(self) -> datetime | None:
		return normalize_datetime(self.db.query(func.max(CommercePrice.last_updated)).scalar())

	def latest_snapshot_at(self) -> datetime | None:
		return normalize_datetime(self.db.query(func.max(CommercePriceSnapshot.observed_at)).scalar())

	def _tracked_price_query(self, mode: str) -> Query:
		query = (
			self.db.query(CommercePrice)
			.outerjoin(IgnoredPriceItem, IgnoredPriceItem.item_id == CommercePrice.item_id)
			.filter(IgnoredPriceItem.item_id.is_(None))
		)

		if mode == "relevant":
			relevant_ids = self._relevant_item_ids_subquery()
			query = query.join(relevant_ids, relevant_ids.c.item_id == CommercePrice.item_id)

		return query

	def _craft_output_ids_subquery(self):
		return select(Recipe.output_item_id.label("item_id")).distinct().subquery()

	def _ingredient_ids_subquery(self):
		return select(RecipeIngredient.item_id.label("item_id")).distinct().subquery()

	def _relevant_item_ids_subquery(self):
		output_ids = select(Recipe.output_item_id.label("item_id"))
		ingredient_ids = select(RecipeIngredient.item_id.label("item_id"))
		return output_ids.union(ingredient_ids).subquery()

	def _roll_up_snapshots(
		self,
		bucket_type: str,
		bucket_format: str,
		older_than: datetime,
		created_at: datetime,
	) -> int:
		result = self.db.execute(
			text(
				"""
				INSERT OR REPLACE INTO commerce_price_rollups (
					item_id,
					bucket_type,
					bucket_start,
					sample_count,
					buy_price_min,
					buy_price_avg,
					buy_price_max,
					sell_price_min,
					sell_price_avg,
					sell_price_max,
					buy_quantity_avg,
					sell_quantity_avg,
					created_at
				)
				SELECT
					item_id,
					:bucket_type,
					strftime(:bucket_format, observed_at),
					COUNT(*),
					MIN(buy_price),
					AVG(buy_price),
					MAX(buy_price),
					MIN(sell_price),
					AVG(sell_price),
					MAX(sell_price),
					AVG(buy_quantity),
					AVG(sell_quantity),
					:created_at
				FROM commerce_price_snapshots
				WHERE observed_at < :older_than
				GROUP BY item_id, strftime(:bucket_format, observed_at)
				"""
			),
			{
				"bucket_type": bucket_type,
				"bucket_format": bucket_format,
				"older_than": older_than,
				"created_at": created_at,
			},
		)
		return max(result.rowcount or 0, 0)

	def _prune_to_max_history_size(self, max_history_mb: int) -> dict[str, int]:
		max_bytes = max_history_mb * BYTES_PER_MEGABYTE
		deleted = {
			"raw_snapshots_deleted": 0,
			"hourly_rollups_deleted": 0,
			"daily_rollups_deleted": 0,
		}

		for table_kind, row_bytes, key in [
			("raw", SNAPSHOT_ROW_ESTIMATED_BYTES, "raw_snapshots_deleted"),
			("hour", ROLLUP_ROW_ESTIMATED_BYTES, "hourly_rollups_deleted"),
			("day", ROLLUP_ROW_ESTIMATED_BYTES, "daily_rollups_deleted"),
		]:
			current_bytes = self._estimated_history_bytes()
			if current_bytes <= max_bytes:
				break

			over_bytes = current_bytes - max_bytes
			rows_to_delete = max(1, math.ceil(over_bytes / row_bytes))
			deleted[key] += self._delete_oldest_history_rows(table_kind, rows_to_delete)
			self.db.commit()

		return deleted

	def _estimated_history_bytes(self) -> int:
		raw_count = self.db.query(func.count()).select_from(CommercePriceSnapshot).scalar() or 0
		rollup_count = self.db.query(func.count()).select_from(CommercePriceRollup).scalar() or 0
		return (raw_count * SNAPSHOT_ROW_ESTIMATED_BYTES) + (rollup_count * ROLLUP_ROW_ESTIMATED_BYTES)

	def _delete_oldest_history_rows(self, table_kind: str, limit: int) -> int:
		if table_kind == "raw":
			result = self.db.execute(
				text(
					"""
					DELETE FROM commerce_price_snapshots
					WHERE rowid IN (
						SELECT rowid
						FROM commerce_price_snapshots
						ORDER BY observed_at ASC
						LIMIT :limit
					)
					"""
				),
				{"limit": limit},
			)
			return max(result.rowcount or 0, 0)

		result = self.db.execute(
			text(
				"""
				DELETE FROM commerce_price_rollups
				WHERE rowid IN (
					SELECT rowid
					FROM commerce_price_rollups
					WHERE bucket_type = :bucket_type
					ORDER BY bucket_start ASC
					LIMIT :limit
				)
				"""
			),
			{"bucket_type": table_kind, "limit": limit},
		)
		return max(result.rowcount or 0, 0)

	def _coerce_config_value(self, key: str, value: str) -> int | bool | str:
		if key == "auto_price_sync_enabled":
			return value.lower() == "true"

		if key == "snapshot_item_mode":
			return value if value in {"relevant", "all"} else DEFAULT_CONFIG[key]

		return self._validate_config_value(key, int(value))

	def _validate_config_value(self, key: str, value: Any) -> int | bool | str:
		if key == "auto_price_sync_enabled":
			return bool(value)

		if key == "snapshot_item_mode":
			if value not in {"relevant", "all"}:
				raise ValueError("snapshot_item_mode must be relevant or all")
			return str(value)

		if key in CONFIG_LIMITS:
			min_value, max_value = CONFIG_LIMITS[key]
			int_value = int(value)
			return min(max(int_value, min_value), max_value)

		return value

	def _serialize_config_value(self, value: int | bool | str) -> str:
		if isinstance(value, bool):
			return "true" if value else "false"

		return str(value)

	def _is_tracked_by_config(
		self,
		mode: str,
		has_price: bool,
		is_relevant: bool,
		is_ignored: bool,
	) -> bool:
		if is_ignored or not has_price:
			return False

		if mode == "all":
			return True

		return is_relevant
