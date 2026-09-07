from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

from app.models import CommercePrice, CommercePriceSnapshot
from app.services.craft_planner import CraftPlanner
from app.services.profit_engine import ProfitEngine
from app.services.reservation_service import set_reservation
from test_api_endpoints import db_session, client, seed_simple_recipe, add_item, add_price, add_recipe
from test_account_eligibility import account, metadata
from test_trading_post_plans import trading, book
from app.services.order_planner import OrderAwarePlanner
from app.services.gw2_client import GW2Client


def graph(db):
    seed_simple_recipe(db)
    for item_id, price in [(4, 40), (5, 10), (6, 5), (99, 100)]:
        add_item(db, item_id, f"Material {item_id}")
        add_price(db, item_id, price, price * 2)
    add_recipe(db, 2, 1, [(4, 2), (3, 1)])  # Alternative root recipe.
    add_recipe(db, 3, 4, [(5, 2), (6, 1)])
    add_recipe(db, 4, 2, [(4, 1)])
    add_recipe(db, 5, 5, [(2, 1)])  # Cycle with a purchasable escape route.
    add_recipe(db, 99, 99, [(6, 1)])  # Unrelated output sharing a leaf.
    db.commit()
    for recipe_id in [1, 2, 3, 4, 5, 99]:
        metadata(db, recipe_id, flags=("AutoLearned",))
    now = datetime.now(timezone.utc)
    for item_id in [1, 99]:
        for n in range(4):
            db.add(CommercePriceSnapshot(item_id=item_id, observed_at=now-timedelta(hours=3-n),
                buy_price=500+n, sell_price=1000+n, buy_quantity=100-n, sell_quantity=100+n))
    db.commit()


def stable(value):
    if isinstance(value, dict):
        return {key: stable(item) for key, item in value.items() if key != "observed_at"}
    if isinstance(value, list):
        return [stable(item) for item in value]
    return value


@pytest.mark.parametrize("material,output", [("buy", "buy"), ("buy", "sell"), ("sell", "buy"), ("sell", "sell")])
@pytest.mark.parametrize("recipe_id", [None, 1, 2])
def test_scoped_graph_matches_full_quotes_with_alternatives_and_cycles(db_session, material, output, recipe_id):
    graph(db_session)
    full = ProfitEngine(db_session)
    scoped = ProfitEngine(db_session, root_item_id=1)
    assert set(scoped.items_by_id) == {1, 2, 3, 4, 5, 6}
    assert {r.id for rows in scoped.recipes_by_output_item_id.values() for r in rows} == {1, 2, 3, 4, 5}
    assert scoped.price_history_item_ids == {1}
    assert set(scoped.market_flow_by_item_id) == {1}
    assert stable(scoped.calculate_profit(1, material, output, recipe_id=recipe_id)) == stable(
        full.calculate_profit(1, material, output, recipe_id=recipe_id))


def test_account_stock_reservations_and_new_prices_remain_request_scoped(db_session):
    graph(db_session)
    account(db_session, "A", stock=3)
    account(db_session, "B", stock=1)
    set_reservation(db_session, "A", 2, 1, "Keep", 0)
    results = {}
    for account_id in ["A", "B"]:
        full = ProfitEngine(db_session, account_id)
        scoped = ProfitEngine(db_session, account_id, root_item_id=1)
        expected = CraftPlanner(full, require_eligible=True).build(1, use_owned=True, recipe_id=1)
        results[account_id] = CraftPlanner(scoped, require_eligible=True).build(1, use_owned=True, recipe_id=1)
        assert stable(results[account_id]) == stable(expected)
        assert results[account_id]["account_id"] == account_id
    assert results["A"]["consumed"] != results["B"]["consumed"]
    before = ProfitEngine(db_session, root_item_id=1).get_buy_price(3)
    db_session.get(CommercePrice, 3).buy_price = before + 50
    db_session.commit()
    assert ProfitEngine(db_session, root_item_id=1).get_buy_price(3) == before + 50


def test_order_aware_plan_matches_full_loading(db_session):
    seed_simple_recipe(db_session)
    metadata(db_session, 1, flags=("AutoLearned",))
    account(db_session, stock=1)
    trading(db_session)
    plans = [OrderAwarePlanner(engine, "buy", "buy", "buy", listing_provider=book,
             require_eligible=True).build(1, use_owned=True)
             for engine in [ProfitEngine(db_session, "A", include_history=False),
                            ProfitEngine(db_session, "A", include_history=False, root_item_id=1)]]
    assert stable(plans[0]) == stable(plans[1])


@pytest.mark.parametrize("suffix", ["", "/scenarios", "/plan", "/listing-depth"])
def test_item_endpoints_do_not_scan_unrelated_catalog_or_history(db_session, client, monkeypatch, suffix):
    graph(db_session)
    monkeypatch.setattr(GW2Client, "fetch_commerce_listing", lambda self, item_id: book(item_id))
    statements = []
    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    event.listen(db_session.bind, "before_cursor_execute", record)
    try:
        response = client.get(f"/api/profit/1{suffix}")
    finally:
        event.remove(db_session.bind, "before_cursor_execute", record)
    assert response.status_code == 200
    public_queries = [s for s in statements if any(f"FROM {table}" in s for table in
        ("items", "recipes", "commerce_prices", "commerce_price_snapshots", "commerce_price_rollups"))]
    assert public_queries
    assert all("WHERE" in statement for statement in public_queries)
    if suffix in {"/plan", "/listing-depth"}:
        assert not any("commerce_price_snapshots" in s or "commerce_price_rollups" in s for s in statements)


def test_unknown_item_remains_unavailable(db_session, client):
    seed_simple_recipe(db_session)
    assert client.get("/api/profit/999999").status_code == 404
    assert client.get("/api/profit/999999/plan").json()["status"] == "unavailable"
