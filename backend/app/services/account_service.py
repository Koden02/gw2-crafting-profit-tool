from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.account_holding import AccountHolding
from app.services.gw2_client import GW2Client


class AccountService:
	def __init__(self, db: Session) -> None:
		self.db = db
		self.client = GW2Client()

	def sync_holdings(self, api_key: str) -> dict[str, Any]:
		materials = self.client.fetch_account_materials(api_key)
		bank = self.client.fetch_account_bank(api_key)

		material_counts = self._aggregate_materials(materials)
		bank_counts = self._aggregate_bank(bank)
		all_item_ids = set(material_counts) | set(bank_counts)
		now = datetime.now(timezone.utc)

		self.db.query(AccountHolding).delete()

		total_owned = 0
		for item_id in all_item_ids:
			material_count = material_counts.get(item_id, 0)
			bank_count = bank_counts.get(item_id, 0)
			total_count = material_count + bank_count
			total_owned += total_count

			self.db.add(
				AccountHolding(
					item_id=item_id,
					material_count=material_count,
					bank_count=bank_count,
					total_count=total_count,
					last_updated=now,
				)
			)

		self.db.commit()

		return {
			"status": "ok",
			"material_items": len(material_counts),
			"bank_items": len(bank_counts),
			"unique_items": len(all_item_ids),
			"total_owned": total_owned,
			"last_updated": now,
		}

	def _aggregate_materials(self, materials: list[dict[str, Any]]) -> dict[int, int]:
		counts: defaultdict[int, int] = defaultdict(int)

		for material in materials:
			item_id = material.get("id")
			count = material.get("count", 0)
			if isinstance(item_id, int) and isinstance(count, int) and count > 0:
				counts[item_id] += count

		return dict(counts)

	def _aggregate_bank(self, bank: list[dict[str, Any] | None]) -> dict[int, int]:
		counts: defaultdict[int, int] = defaultdict(int)

		for stack in bank:
			if stack is None:
				continue

			item_id = stack.get("id")
			count = stack.get("count", 0)
			if isinstance(item_id, int) and isinstance(count, int) and count > 0:
				counts[item_id] += count

		return dict(counts)
