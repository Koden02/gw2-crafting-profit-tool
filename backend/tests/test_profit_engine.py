from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.models import AccountHolding, CommercePrice, Item, Recipe, RecipeIngredient
from app.services.profit_engine import ProfitEngine


@pytest.fixture
def db_session() -> Iterator[Session]:
	engine = create_engine("sqlite:///:memory:")
	Base.metadata.create_all(engine)

	SessionLocal = sessionmaker(bind=engine)
	session = SessionLocal()

	try:
		yield session
	finally:
		session.close()
		Base.metadata.drop_all(engine)
		engine.dispose()


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


def seed_simple_recipe(
	db: Session,
	output_sell_price: int = 1000,
	output_buy_price: int = 500,
	buy_quantity: int = 10,
	sell_quantity: int = 10,
) -> None:
	add_item(db, 1, "Test Output")
	add_item(db, 2, "Test Ingredient A")
	add_item(db, 3, "Test Ingredient B")

	add_price(
		db,
		1,
		buy_price=output_buy_price,
		sell_price=output_sell_price,
		buy_quantity=buy_quantity,
		sell_quantity=sell_quantity,
	)
	add_price(db, 2, buy_price=100, sell_price=200)
	add_price(db, 3, buy_price=50, sell_price=70)

	add_recipe(db, 1, output_item_id=1, ingredients=[(2, 2), (3, 3)])
	db.commit()


def test_trading_post_fees_floor_to_integer_copper() -> None:
	assert ProfitEngine.listing_fee(101) == 5
	assert ProfitEngine.exchange_fee(101) == 10
	assert ProfitEngine.trading_post_net(101) == 86

	assert ProfitEngine.listing_fee(1) == 1
	assert ProfitEngine.exchange_fee(1) == 1


def test_calculates_simple_recipe_craft_cost(db_session: Session) -> None:
	seed_simple_recipe(db_session)

	engine = ProfitEngine(db_session)

	assert engine.calculate_craft_cost(1, material_pricing="buy") == 350


def test_value_add_compares_crafted_value_to_selling_ingredients(db_session: Session) -> None:
	seed_simple_recipe(db_session, output_sell_price=1000)

	result = ProfitEngine(db_session).calculate_profit(1)

	assert result is not None
	assert result["ingredient_sale_value"] == 520
	assert result["crafted_item_value"] == 850
	assert result["value_add"] == 330


@pytest.mark.parametrize(
	("output_sell_price", "expected_recommendation"),
	[
		(1000, "Craft"),
		(500, "Sell Ingredients"),
		(611, "Break Even"),
	],
)
def test_recommendation_returns_expected_value(
	db_session: Session,
	output_sell_price: int,
	expected_recommendation: str,
) -> None:
	seed_simple_recipe(db_session, output_sell_price=output_sell_price)

	result = ProfitEngine(db_session).calculate_profit(1)

	assert result is not None
	assert result["recommendation"] == expected_recommendation


def test_pricing_strategy_modes_affect_craft_cost_and_sale_value(db_session: Session) -> None:
	seed_simple_recipe(db_session, output_sell_price=1000, output_buy_price=500)

	engine = ProfitEngine(db_session)

	buy_materials_list_sell = engine.calculate_profit(
		1,
		material_pricing="buy",
		output_pricing="sell",
	)
	instant_buy_materials_instant_sell = engine.calculate_profit(
		1,
		material_pricing="sell",
		output_pricing="buy",
	)

	assert buy_materials_list_sell is not None
	assert instant_buy_materials_instant_sell is not None
	assert buy_materials_list_sell["craft_cost"] == 350
	assert instant_buy_materials_instant_sell["craft_cost"] == 610
	assert buy_materials_list_sell["net_sale"] == 850
	assert instant_buy_materials_instant_sell["net_sale"] == 425


def test_low_liquidity_flag_uses_buy_and_sell_quantities(db_session: Session) -> None:
	seed_simple_recipe(db_session, buy_quantity=4, sell_quantity=10)

	low_buy_quantity = ProfitEngine(db_session).calculate_profit(1)

	assert low_buy_quantity is not None
	assert low_buy_quantity["low_liquidity"] is True

	db_session.query(CommercePrice).filter(CommercePrice.item_id == 1).update(
		{
			"buy_quantity": 5,
			"sell_quantity": 5,
		}
	)
	db_session.commit()

	healthy_quantities = ProfitEngine(db_session).calculate_profit(1)

	assert healthy_quantities is not None
	assert healthy_quantities["low_liquidity"] is False


def test_ingredient_breakdown_includes_account_holdings(db_session: Session) -> None:
	seed_simple_recipe(db_session)
	db_session.add(
		AccountHolding(
			item_id=2,
			material_count=1,
			bank_count=0,
			total_count=1,
			last_updated=datetime.now(timezone.utc),
		)
	)
	db_session.add(
		AccountHolding(
			item_id=3,
			material_count=0,
			bank_count=5,
			total_count=5,
			last_updated=datetime.now(timezone.utc),
		)
	)
	db_session.commit()

	result = ProfitEngine(db_session).calculate_profit(1)

	assert result is not None
	ingredients_by_id = {
		ingredient["item_id"]: ingredient
		for ingredient in result["ingredients"]
	}
	assert ingredients_by_id[2]["owned_count"] == 1
	assert ingredients_by_id[2]["missing_count"] == 1
	assert ingredients_by_id[3]["owned_count"] == 5
	assert ingredients_by_id[3]["missing_count"] == 0
