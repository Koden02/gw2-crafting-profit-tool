"""Inventory-only discovery must improve liquidation value without buying inputs."""
from datetime import datetime, timezone

import pytest

from app.models import AccountHolding, AccountProfile, CommercePrice, Recipe, RecipeIngredient
from app.services.craft_planner import CraftPlanner
from app.services.gw2_client import GW2Client
from app.services.profit_engine import ProfitEngine
from app.services.reservation_service import set_reservation
from test_api_endpoints import db_session, client, add_item, add_price, add_recipe
from test_account_eligibility import account, metadata, change_caps
from test_batch_recommendations import setup, finder, book


def stock(db, item_id, count, account_id="A", usable=None):
    db.add(AccountHolding(account_id=account_id, item_id=item_id, material_count=count,
                          bank_count=0, total_count=count, usable_count=count if usable is None else usable,
                          last_updated=datetime.now(timezone.utc)))
    db.commit()


def owned_setup(db):
    setup(db, stock=6)
    stock(db, 3, 9)
    db.get(CommercePrice, 1).buy_price = 1000
    db.commit()


def test_inventory_compares_net_sales_and_stops_at_stock_not_funding(db_session):
    owned_setup(db_session)
    result = finder(db_session).find(1, max_output=5, inventory_only=True, material_pricing="buy")
    plan = result["suggestions"][0]["plan"]
    assert result["budget"] is None and result["inventory_only"]
    assert result["material_pricing"] == "sell"  # No trading-post sync or orders required.
    assert plan["planned_quantity"] == 3
    assert plan["purchases"] == [] and plan["purchase_cost"] == 0
    assert plan["net_revenue"] == 2550 and plan["owned_sale_value"] == 897
    assert plan["economic_gain"] == 1653
    assert plan["additional_gold_needed"] == 150  # Fees still require funding.
    assert "usable stock" in result["suggestions"][0]["quantity_limit_reason"]


@pytest.mark.parametrize("blocked", ["missing", "reserved", "bound", "locked", "stale"])
def test_unusable_or_missing_inventory_never_becomes_a_purchase(db_session, blocked):
    owned_setup(db_session)
    if blocked == "missing":
        db_session.query(AccountHolding).filter_by(account_id="A", item_id=3).delete()
    elif blocked == "reserved":
        set_reservation(db_session, "A", 2, 6, "Keep", 0)
    elif blocked == "bound":
        db_session.query(AccountHolding).filter_by(account_id="A", item_id=3).one().usable_count = 0
    elif blocked == "locked":
        change_caps(db_session, lambda p: p["account_recipes"].update(data=[]))
    else:
        db_session.get(AccountProfile, "A").coverage = "{}"
    db_session.commit()
    result = finder(db_session).find(max_output=5, inventory_only=True)
    assert result["suggestions"] == [] and result["issues"]


def test_positive_sale_proceeds_do_not_make_a_losing_conversion_profitable(db_session):
    owned_setup(db_session)
    db_session.get(CommercePrice, 1).buy_price = 300
    db_session.commit()
    def losing_book(item_id):
        result = book(item_id)
        if item_id == 1:
            result["buys"][0]["unit_price"] = 300
        return result
    result = finder(db_session, losing_book).find(max_output=5, inventory_only=True)
    assert result["candidates_checked"] == 1 and not result["suggestions"]
    assert "does not prove" in result["issues"][-1]


def test_nested_owned_route_is_used_even_when_buying_intermediate_is_cheaper(db_session):
    owned_setup(db_session)
    add_item(db_session, 4, "Intermediate")
    add_price(db_session, 4, 1, 2)
    add_recipe(db_session, 4, 4, [(2, 2)])
    metadata(db_session, 4, flags=("AutoLearned",))
    ingredient = db_session.query(RecipeIngredient).filter_by(recipe_id=1, item_id=2).one()
    ingredient.item_id = 4
    db_session.commit()
    # Buying the intermediate is cheaper, but this mode must craft from stock.
    result = finder(db_session).find(max_output=5, inventory_only=True)
    plan = next(s["plan"] for s in result["suggestions"] if s["plan"]["item_id"] == 1)
    assert plan["planned_quantity"] == 1 and plan["purchase_cost"] == 0
    assert [step["recipe_id"] for step in plan["steps"]] == [4, 1]
    assert {r["item_id"]: r["quantity"] for r in plan["consumed"]} == {2: 4, 3: 3}


def test_unowned_high_profit_recipes_cannot_crowd_out_inventory_crafts(db_session):
    owned_setup(db_session)
    add_item(db_session, 5, "Unowned ingredient")
    add_price(db_session, 5, 1, 2)
    for item_id in range(100, 120):
        add_item(db_session, item_id, f"Unowned opportunity {item_id}")
        add_price(db_session, item_id, 100000, 110000)
        add_recipe(db_session, item_id, item_id, [(5, 1)])
        metadata(db_session, item_id, flags=("AutoLearned",))
    db_session.commit()
    result = finder(db_session).find(max_output=5, inventory_only=True)
    assert result["candidate_count"] == 1
    assert result["suggestions"][0]["plan"]["item_id"] == 1


def test_live_depth_and_whole_output_caps_still_apply(db_session):
    owned_setup(db_session)
    db_session.get(Recipe, 1).output_item_count = 5
    db_session.commit()
    assert not finder(db_session).find(max_output=4, inventory_only=True)["suggestions"]
    def thin_book(item_id):
        result = book(item_id)
        if item_id == 1:
            result["buys"][0]["quantity"] = 9
        return result
    result = finder(db_session, thin_book).find(max_output=20, inventory_only=True)
    assert result["suggestions"][0]["plan"]["planned_quantity"] == 5


def test_plan_refresh_preserves_inventory_constraint_and_account_isolation(client, db_session, monkeypatch):
    owned_setup(db_session)
    account(db_session, "B")
    db_session.get(AccountProfile, "B").coverage = db_session.get(AccountProfile, "A").coverage
    db_session.commit()
    monkeypatch.setattr(GW2Client, "fetch_commerce_listing", lambda self, item_id: book(item_id))
    request = dict(account_id="A", inventory_only=True, max_output=5, minimum_gain=1)
    response = client.post("/api/craft-recommendations", json=request)
    assert response.status_code == 200 and response.json()["suggestions"]
    assert client.post("/api/craft-recommendations", json={**request, "account_id": "B"}).json()["suggestions"] == []
    params = dict(account_id="A", inventory_only=True, quantity=3, recipe_id=1,
                  material_pricing="sell", output_pricing="buy", check_depth=True)
    plan = client.get("/api/profit/1/plan", params=params).json()
    assert plan["economic_gain"] == response.json()["suggestions"][0]["plan"]["economic_gain"]
    assert plan["inventory_only"] and not plan["purchases"]
    too_large = client.get("/api/profit/1/plan", params={**params, "quantity": 4}).json()
    assert too_large["status"] == "unavailable" and not too_large["purchases"]
    assert client.get("/api/profit/1/plan", params={"inventory_only": True}).status_code == 422
    assert client.get("/api/profit/1/plan", params={**params, "use_trading_post": True}).status_code == 422
    assert client.post("/api/craft-recommendations", json={**request, "inventory_only": False}).status_code == 422


def test_inventory_planner_requires_an_explicit_account(db_session):
    owned_setup(db_session)
    with pytest.raises(ValueError, match="Select an account"):
        CraftPlanner(ProfitEngine(db_session), inventory_only=True).build(1)
