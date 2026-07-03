from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.dependencies import get_db
from app.main import app
from app.models import AccountHolding, CommercePrice, CommercePriceRollup, CommercePriceSnapshot, Item, Recipe, RecipeIngredient
from app.services.gw2_client import GW2Client
from app.services.price_history_service import PriceHistoryService
from app.services.price_sync_lock import price_sync_lock
import app.services.price_history_service as price_history_module


@pytest.fixture
def db_session() -> Iterator[Session]:
	engine = create_engine(
		"sqlite://",
		connect_args={"check_same_thread": False},
		poolclass=StaticPool,
	)
	Base.metadata.create_all(engine)

	SessionLocal = sessionmaker(bind=engine)
	session = SessionLocal()

	try:
		yield session
	finally:
		session.close()
		Base.metadata.drop_all(engine)
		engine.dispose()


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
	def override_get_db() -> Iterator[Session]:
		yield db_session

	app.dependency_overrides[get_db] = override_get_db

	try:
		yield TestClient(app)
	finally:
		app.dependency_overrides.clear()


def add_item(db: Session, item_id: int, name: str) -> None:
	db.add(
		Item(
			id=item_id,
			name=name,
			type="Material",
			rarity="Basic",
			level=0,
			vendor_value=0,
			flags="[]",
		)
	)


def add_price(
	db: Session,
	item_id: int,
	buy_price: int,
	sell_price: int,
	buy_quantity: int = 10,
	sell_quantity: int = 10,
) -> None:
	db.add(
		CommercePrice(
			item_id=item_id,
			buy_price=buy_price,
			buy_quantity=buy_quantity,
			sell_price=sell_price,
			sell_quantity=sell_quantity,
			last_updated=datetime.now(timezone.utc),
		)
	)


def add_recipe(
	db: Session,
	recipe_id: int,
	output_item_id: int,
	ingredients: list[tuple[int, int]],
	output_item_count: int = 1,
) -> None:
	recipe = Recipe(
		id=recipe_id,
		output_item_id=output_item_id,
		output_item_count=output_item_count,
		disciplines=json.dumps(["Artificer"]),
	)
	db.add(recipe)

	for item_id, count in ingredients:
		db.add(
			RecipeIngredient(
				recipe_id=recipe_id,
				item_id=item_id,
				count=count,
			)
		)


def seed_simple_recipe(db: Session) -> None:
	add_item(db, 1, "Test Output")
	add_item(db, 2, "Test Ingredient A")
	add_item(db, 3, "Test Ingredient B")

	add_price(db, 1, buy_price=500, sell_price=1000)
	add_price(db, 2, buy_price=100, sell_price=200)
	add_price(db, 3, buy_price=50, sell_price=70)
	add_recipe(db, 1, output_item_id=1, ingredients=[(2, 2), (3, 3)])

	db.commit()


def test_health_endpoint_returns_ok(client: TestClient) -> None:
	response = client.get("/api/health")

	assert response.status_code == 200
	assert response.json() == {"status": "ok"}


def test_debug_endpoints_are_hidden_from_openapi(client: TestClient) -> None:
	response = client.get("/openapi.json")

	assert response.status_code == 200
	paths = response.json()["paths"]
	assert "/api/debug/items/{item_id}" not in paths
	assert "/api/debug/recipes/{item_id}" not in paths
	assert "/api/debug/prices/{item_id}" not in paths


def test_profit_detail_endpoint_returns_calculated_profit(
	client: TestClient,
	db_session: Session,
) -> None:
	seed_simple_recipe(db_session)

	response = client.get("/api/profit/1")

	assert response.status_code == 200
	body = response.json()
	assert body["item_id"] == 1
	assert body["name"] == "Test Output"
	assert body["craft_cost"] == 350
	assert body["net_sale"] == 850
	assert body["profit"] == 500
	assert body["value_add"] == 330
	assert body["recommendation"] == "Craft"
	assert body["has_price_history"] is False
	assert len(body["ingredients"]) == 2


def test_profit_scenarios_endpoint_returns_all_pricing_modes(
	client: TestClient,
	db_session: Session,
) -> None:
	seed_simple_recipe(db_session)

	response = client.get("/api/profit/1/scenarios")

	assert response.status_code == 200
	scenarios = response.json()
	assert {(scenario["material_pricing"], scenario["output_pricing"]) for scenario in scenarios} == {
		("buy", "sell"),
		("buy", "buy"),
		("sell", "sell"),
		("sell", "buy"),
	}


def test_profitable_crafts_endpoint_returns_seeded_recipe(
	client: TestClient,
	db_session: Session,
) -> None:
	seed_simple_recipe(db_session)

	response = client.get("/api/profitable-crafts", params={"limit": 5, "min_profit": 0})

	assert response.status_code == 200
	rows = response.json()
	assert len(rows) == 1
	assert rows[0]["item_id"] == 1
	assert rows[0]["profit"] == 500
	assert rows[0]["has_price_history"] is False


def test_profitable_crafts_endpoint_marks_recorded_price_history(
	client: TestClient,
	db_session: Session,
) -> None:
	seed_simple_recipe(db_session)
	db_session.add(
		CommercePriceSnapshot(
			item_id=1,
			observed_at=datetime.now(timezone.utc),
			buy_price=500,
			buy_quantity=10,
			sell_price=1000,
			sell_quantity=20,
		)
	)
	db_session.commit()

	response = client.get("/api/profitable-crafts", params={"limit": 5, "min_profit": 0})

	assert response.status_code == 200
	rows = response.json()
	assert len(rows) == 1
	assert rows[0]["has_price_history"] is True


def test_listing_depth_endpoint_uses_gw2_listing_data(
	client: TestClient,
	db_session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	seed_simple_recipe(db_session)

	def fake_fetch_commerce_listing(self: GW2Client, item_id: int) -> dict:
		assert item_id == 1
		return {
			"buys": [
				{"unit_price": 410, "quantity": 5, "listings": 1},
				{"unit_price": 500, "quantity": 10, "listings": 2},
			],
			"sells": [
				{"unit_price": 500, "quantity": 20, "listings": 4},
				{"unit_price": 600, "quantity": 40, "listings": 8},
			],
		}

	monkeypatch.setattr(GW2Client, "fetch_commerce_listing", fake_fetch_commerce_listing)

	response = client.get("/api/profit/1/listing-depth")

	assert response.status_code == 200
	body = response.json()
	assert body["item_id"] == 1
	assert body["instant_sell_limit_quantity"] == 10
	assert body["instant_sell_depth_profit"] == 750
	assert body["estimated_market_pressure"] == "healthy market"


def test_sync_status_endpoint_reports_cache_counts(
	client: TestClient,
	db_session: Session,
) -> None:
	seed_simple_recipe(db_session)

	response = client.get("/api/sync/status")

	assert response.status_code == 200
	body = response.json()
	assert body["item_count"] == 3
	assert body["recipe_count"] == 1
	assert body["price_count"] == 3
	assert body["price_last_updated"] is not None


def test_manual_price_sync_records_due_price_history(
	client: TestClient,
	db_session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	seed_simple_recipe(db_session)

	def fake_fetch_all_commerce_price_ids(self: GW2Client) -> list[int]:
		return [1, 2, 3]

	def fake_fetch_commerce_prices_by_ids(self: GW2Client, item_ids: list[int]) -> list[dict]:
		return [
			{
				"id": item_id,
				"buys": {"unit_price": 500 + item_id, "quantity": 10},
				"sells": {"unit_price": 1000 + item_id, "quantity": 20},
			}
			for item_id in item_ids
		]

	monkeypatch.setattr(GW2Client, "fetch_all_commerce_price_ids", fake_fetch_all_commerce_price_ids)
	monkeypatch.setattr(GW2Client, "fetch_commerce_prices_by_ids", fake_fetch_commerce_prices_by_ids)

	response = client.post("/api/sync/prices")

	assert response.status_code == 200
	body = response.json()
	assert body["prices_upserted"] == 3
	assert body["snapshots_recorded"] == 3
	assert db_session.query(CommercePriceSnapshot).count() == 3


def test_manual_price_sync_returns_conflict_when_sync_is_already_running(
	client: TestClient,
) -> None:
	with price_sync_lock.acquire("test"):
		response = client.post("/api/sync/prices")

	assert response.status_code == 409
	assert response.json()["detail"] == "Trading Post price sync is already running."


def test_price_history_config_pause_resume_and_estimate(
	client: TestClient,
	db_session: Session,
) -> None:
	seed_simple_recipe(db_session)

	status_response = client.get("/api/sync/auto-price/status")
	assert status_response.status_code == 200
	assert status_response.json()["enabled"] is True
	assert status_response.json()["interval_minutes"] == 15

	pause_response = client.post("/api/sync/auto-price/pause")
	assert pause_response.status_code == 200
	assert pause_response.json()["enabled"] is False

	config_response = client.patch(
		"/api/sync/price-history/config",
		json={
			"price_sync_interval_minutes": 30,
			"raw_snapshot_retention_days": 7,
			"max_history_mb": 256,
			"snapshot_item_mode": "all",
		},
	)
	assert config_response.status_code == 200
	config = config_response.json()
	assert config["price_sync_interval_minutes"] == 30
	assert config["raw_snapshot_retention_days"] == 7
	assert config["max_history_mb"] == 256
	assert config["snapshot_item_mode"] == "all"

	estimate_response = client.get("/api/sync/price-history/estimate")
	assert estimate_response.status_code == 200
	estimate = estimate_response.json()
	assert estimate["tracked_item_count"] == 3
	assert estimate["runs_per_day"] == 48
	assert estimate["estimated_total_retention_mb"] > 0

	resume_response = client.post("/api/sync/auto-price/resume")
	assert resume_response.status_code == 200
	assert resume_response.json()["enabled"] is True


def test_price_history_relevance_and_ignore_controls(
	client: TestClient,
	db_session: Session,
) -> None:
	seed_simple_recipe(db_session)
	add_item(db_session, 4, "Unused Item")
	add_price(db_session, 4, buy_price=1, sell_price=2)
	db_session.commit()

	relevance_response = client.get("/api/sync/price-history/relevance", params={"filter": "relevant"})

	assert relevance_response.status_code == 200
	relevance = relevance_response.json()
	assert relevance["total"] == 3
	assert {item["item_id"] for item in relevance["items"]} == {1, 2, 3}
	assert all(item["is_tracked"] for item in relevance["items"])

	ignore_response = client.post("/api/sync/price-history/ignore/2", json={"reason": "not useful"})
	assert ignore_response.status_code == 200
	assert ignore_response.json()["ignored"] is True

	estimate_response = client.get("/api/sync/price-history/estimate")
	assert estimate_response.status_code == 200
	estimate = estimate_response.json()
	assert estimate["ignored_item_count"] == 1
	assert estimate["tracked_item_count"] == 2

	ignored_response = client.get("/api/sync/price-history/relevance", params={"filter": "ignored"})
	assert ignored_response.status_code == 200
	ignored_items = ignored_response.json()["items"]
	assert len(ignored_items) == 1
	assert ignored_items[0]["item_id"] == 2
	assert ignored_items[0]["is_ignored"] is True
	assert ignored_items[0]["is_tracked"] is False

	restore_response = client.delete("/api/sync/price-history/ignore/2")
	assert restore_response.status_code == 200
	assert restore_response.json()["ignored"] is False

	restored_estimate_response = client.get("/api/sync/price-history/estimate")
	assert restored_estimate_response.status_code == 200
	assert restored_estimate_response.json()["tracked_item_count"] == 3


def test_price_history_endpoint_returns_raw_snapshots(
	client: TestClient,
	db_session: Session,
) -> None:
	seed_simple_recipe(db_session)
	now = datetime.now(timezone.utc).replace(microsecond=0)
	db_session.add_all(
		[
			CommercePriceSnapshot(
				item_id=1,
				observed_at=now - timedelta(hours=2),
				buy_price=490,
				buy_quantity=8,
				sell_price=980,
				sell_quantity=18,
			),
			CommercePriceSnapshot(
				item_id=1,
				observed_at=now - timedelta(hours=1),
				buy_price=510,
				buy_quantity=12,
				sell_price=1020,
				sell_quantity=22,
			),
		]
	)
	db_session.commit()

	response = client.get(
		"/api/price-history/1",
		params={"range_days": 7, "resolution": "raw"},
	)

	assert response.status_code == 200
	body = response.json()
	assert body["item_id"] == 1
	assert body["name"] == "Test Output"
	assert body["resolution"] == "raw"
	assert body["range_days"] == 7
	assert body["point_count"] == 2
	assert [point["sell_price"] for point in body["points"]] == [980, 1020]
	assert body["points"][0]["sample_count"] == 1


def test_price_history_endpoint_returns_rollup_points(
	client: TestClient,
	db_session: Session,
) -> None:
	seed_simple_recipe(db_session)
	now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
	db_session.add(
		CommercePriceRollup(
			item_id=1,
			bucket_type="hour",
			bucket_start=now - timedelta(days=3),
			sample_count=4,
			buy_price_min=480,
			buy_price_avg=500.5,
			buy_price_max=520,
			sell_price_min=980,
			sell_price_avg=1000.5,
			sell_price_max=1040,
			buy_quantity_avg=9.5,
			sell_quantity_avg=19.5,
			created_at=now,
		)
	)
	db_session.commit()

	response = client.get(
		"/api/price-history/1",
		params={"range_days": 30, "resolution": "hour"},
	)

	assert response.status_code == 200
	body = response.json()
	assert body["resolution"] == "hour"
	assert body["point_count"] == 1
	point = body["points"][0]
	assert point["sample_count"] == 4
	assert point["buy_price"] == pytest.approx(500.5)
	assert point["buy_price_min"] == 480
	assert point["buy_price_max"] == 520
	assert point["sell_price"] == pytest.approx(1000.5)
	assert point["sell_quantity"] == pytest.approx(19.5)


def test_price_history_endpoint_returns_not_found_for_unknown_item(
	client: TestClient,
) -> None:
	response = client.get("/api/price-history/999999")

	assert response.status_code == 404
	assert response.json()["detail"] == "Item not found"


def test_price_history_config_persists_across_service_instances(db_session: Session) -> None:
	service = PriceHistoryService(db_session)
	service.update_config(
		{
			"price_sync_interval_minutes": 45,
			"raw_snapshot_retention_days": 21,
			"snapshot_item_mode": "all",
		}
	)

	reloaded_config = PriceHistoryService(db_session).get_config()

	assert reloaded_config["price_sync_interval_minutes"] == 45
	assert reloaded_config["raw_snapshot_retention_days"] == 21
	assert reloaded_config["snapshot_item_mode"] == "all"


def test_ignored_items_are_excluded_from_price_history_snapshots(db_session: Session) -> None:
	seed_simple_recipe(db_session)
	service = PriceHistoryService(db_session)
	service.ignore_item(2, reason="not useful")

	recorded_count = service.record_snapshot(observed_at=datetime.now(timezone.utc))
	snapshot_item_ids = {
		item_id
		for item_id, in db_session.query(CommercePriceSnapshot.item_id).all()
	}

	assert recorded_count == 2
	assert snapshot_item_ids == {1, 3}


def test_price_history_pruning_rolls_up_and_removes_old_raw_snapshots(db_session: Session) -> None:
	seed_simple_recipe(db_session)
	service = PriceHistoryService(db_session)
	now = datetime.now(timezone.utc)
	old_hour = now.replace(minute=0, second=0, microsecond=0) - timedelta(days=2, hours=1)
	new_hour = now - timedelta(hours=1)

	db_session.add_all(
		[
			CommercePriceSnapshot(
				item_id=1,
				observed_at=old_hour,
				buy_price=500,
				buy_quantity=10,
				sell_price=1000,
				sell_quantity=20,
			),
			CommercePriceSnapshot(
				item_id=1,
				observed_at=old_hour + timedelta(minutes=15),
				buy_price=520,
				buy_quantity=12,
				sell_price=1020,
				sell_quantity=22,
			),
			CommercePriceSnapshot(
				item_id=2,
				observed_at=new_hour,
				buy_price=100,
				buy_quantity=10,
				sell_price=200,
				sell_quantity=20,
			),
		]
	)
	db_session.commit()
	service.update_config({"raw_snapshot_retention_days": 1})

	result = service.prune_history()

	assert result["hourly_rollups_written"] >= 1
	assert result["daily_rollups_written"] >= 1
	assert result["raw_snapshots_deleted"] == 2
	assert db_session.query(CommercePriceSnapshot).count() == 1

	hourly_rollup = (
		db_session.query(CommercePriceRollup)
		.filter(CommercePriceRollup.bucket_type == "hour")
		.first()
	)
	assert hourly_rollup is not None
	assert hourly_rollup.sample_count == 2
	assert hourly_rollup.sell_price_min == 1000
	assert hourly_rollup.sell_price_max == 1020


def test_price_history_max_size_pruning_removes_oldest_rows(
	db_session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	seed_simple_recipe(db_session)
	service = PriceHistoryService(db_session)
	now = datetime.now(timezone.utc)

	for index, item_id in enumerate([1, 2, 3]):
		db_session.add(
			CommercePriceSnapshot(
				item_id=item_id,
				observed_at=now - timedelta(minutes=index),
				buy_price=100 + index,
				buy_quantity=10,
				sell_price=200 + index,
				sell_quantity=20,
			)
		)

	db_session.commit()
	service.update_config({"max_history_mb": 128})
	monkeypatch.setattr(price_history_module, "BYTES_PER_MEGABYTE", 1)

	result = service.prune_history()

	assert result["raw_snapshots_deleted"] > 0
	assert db_session.query(CommercePriceSnapshot).count() < 3


def test_account_holdings_status_endpoint_reports_owned_totals(
	client: TestClient,
	db_session: Session,
) -> None:
	db_session.add(
		AccountHolding(
			item_id=2,
			material_count=3,
			bank_count=4,
			total_count=7,
			last_updated=datetime.now(timezone.utc),
		)
	)
	db_session.commit()

	response = client.get("/api/account/holdings/status")

	assert response.status_code == 200
	body = response.json()
	assert body["holding_count"] == 1
	assert body["total_owned"] == 7
	assert body["last_updated"] is not None
