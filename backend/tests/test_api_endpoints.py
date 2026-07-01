from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.dependencies import get_db
from app.main import app
from app.models import AccountHolding, CommercePrice, Item, Recipe, RecipeIngredient
from app.services.gw2_client import GW2Client


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
