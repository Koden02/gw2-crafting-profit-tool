from datetime import datetime, timedelta, timezone
import json

import httpx
import pytest
from sqlalchemy import create_engine, inspect

from app.db.migrations import migrate
from app.models import AccountTradingPost, AccountProfile, AccountHolding
from app.services.account_service import AccountService
from app.services.gw2_client import GW2Client
from app.services.order_planner import OrderAwarePlanner
from app.services.profit_engine import ProfitEngine
from app.services.reservation_service import set_reservation
from app.services.trading_post_service import normalize_orders, normalize_delivery
from test_api_endpoints import db_session, client
from test_inventory_coverage import inventory_api
from test_batch_recommendations import setup, finder, book
from test_account_eligibility import account


def order(ident=1, item=2, quantity=1, price=90):
    return dict(id=ident, item_id=item, quantity=quantity, price=price, created="2026-09-01T00:00:00Z")


def trading(db, account_id="A", buys=None, pickups=None):
    row = AccountTradingPost(account_id=account_id, snapshot_id=db.get(AccountProfile, account_id).snapshot_id,
        fetched_at=datetime.now(timezone.utc), status="ok", payload=json.dumps(dict(
            buys=normalize_orders(buys if buys is not None else [order(), order(2, 3, price=40)]), sells=[],
            delivery=normalize_delivery(dict(coins=10000, items=pickups if pickups is not None else [dict(id=3, count=1)])))))
    db.add(row)
    db.commit()
    return row


def plan(db, budget=100, provider=book):
    return OrderAwarePlanner(ProfitEngine(db, "A", include_history=False), "buy", "buy", "buy",
                            listing_provider=provider, require_eligible=True).build(1, use_owned=True, budget=budget)


def test_pending_cost_pickup_value_and_new_funding_are_distinct(db_session):
    setup(db_session, stock=1)
    trading(db_session)
    result = plan(db_session)
    assert result["status"] == "quoted" and result["within_budget"]
    assert result["purchase_cost"] == 180  # 130 already committed, 50 new orders
    assert result["additional_gold_needed"] == 100  # 50 new + 50 output listing fee
    assert result["owned_sale_value"] == 128  # inventory A 85 + pickup B 43
    assert result["cash_surplus"] == 670 and result["economic_gain"] == 542
    assert result["procurement"]["state"] == "place_orders"
    a, b = result["purchases"]
    assert (a["pickup_quantity"], a["pending_quantity"], a["new_order_quantity"]) == (0, 1, 0)
    assert (b["pickup_quantity"], b["pending_quantity"], b["new_order_quantity"]) == (1, 1, 1)
    assert sum(r["cost"] for r in result["purchases"]) == result["purchase_cost"]
    assert db_session.get(AccountHolding, ("A", 2)).usable_count == 1
    assert not plan(db_session, budget=99)["within_budget"]


def test_pickup_and_inventory_share_liquidation_depth(db_session):
    setup(db_session, stock=1)
    trading(db_session, buys=[], pickups=[dict(id=2, count=1)])
    def limited(item):
        data = book(item)
        if item == 2:
            data["buys"][0]["quantity"] = 1
        return data
    result = plan(db_session, provider=limited)
    assert result["status"] == "incomplete" and result["economic_gain"] is None


def test_reservations_protect_future_supply_and_do_not_spend_pickup_coins(db_session):
    setup(db_session, stock=1)
    trading(db_session, buys=[order(quantity=3)], pickups=[dict(id=2, count=2)])
    set_reservation(db_session, "A", 2, 4, "Keep future materials", 0)
    result = plan(db_session, budget=0)
    a = result["purchases"][0]
    assert a["pickup_quantity"] == 0 and a["pending_quantity"] == 2
    assert result["procurement"]["committed_cost"] == 180
    assert result["additional_gold_needed"] == 200 and not result["within_budget"]


@pytest.mark.parametrize("buys,pickups,state", [
    ([order(quantity=2), order(2, 3, quantity=3)], [], "waiting_for_orders"),
    ([], [dict(id=2, count=2), dict(id=3, count=3)], "collect_items"),
])
def test_pending_and_pickups_never_mean_ready(db_session, buys, pickups, state):
    setup(db_session)
    trading(db_session, buys=buys, pickups=pickups)
    result = plan(db_session)
    assert result["procurement"]["state"] == state
    assert result["additional_gold_needed"] == 50
    assert result["consumed"] == []


@pytest.mark.parametrize("invalid", ["missing", "stale", "future", "error", "different_snapshot"])
def test_unverified_trading_post_never_reduces_funding(db_session, invalid):
    setup(db_session)
    if invalid != "missing":
        row = trading(db_session)
        if invalid == "stale": row.fetched_at -= timedelta(minutes=11)
        if invalid == "future": row.fetched_at += timedelta(minutes=6)
        if invalid == "error": row.status = "error"
        if invalid == "different_snapshot": row.snapshot_id = "old"
        db_session.commit()
    assert plan(db_session)["status"] == "unavailable"
    assert finder(db_session).find(1000, 1, 2, material_pricing="buy")["suggestions"] == []
    assert finder(db_session).find(1000, 1, 2)["suggestions"]  # original instant mode still works


def test_batch_and_refreshed_plan_reconcile_using_live_bid_targets(client, db_session, monkeypatch):
    setup(db_session, stock=1)
    trading(db_session)
    def changed_book(item):
        data = book(item)
        if item == 3: data["buys"][0]["unit_price"] = 60
        return data
    monkeypatch.setattr(GW2Client, "fetch_commerce_listing", lambda self, item: changed_book(item))
    payload = dict(account_id="A", budget=110, minimum_gain=1, max_output=1, material_pricing="buy")
    response = client.post("/api/craft-recommendations", json=payload)
    assert response.status_code == 200
    suggested = response.json()["suggestions"][0]["plan"]
    refreshed = client.get("/api/profit/1/plan", params=dict(account_id="A", quantity=1, recipe_id=1,
        material_pricing="buy", output_pricing="buy", liquidation_pricing="buy", use_trading_post=True, check_depth=True, budget=110)).json()
    for field in ("purchase_cost", "additional_gold_needed", "economic_gain", "owned_sale_value", "purchases"):
        assert suggested[field] == refreshed[field]
    assert refreshed["purchases"][1]["target_unit_price"] == 60
    assert client.get("/api/profit/1/plan?use_trading_post=true").status_code == 422
    assert client.post("/api/craft-recommendations", json={**payload, "material_pricing":"invalid"}).status_code == 422


def test_sync_replaces_empty_orders_preserves_failed_payload_and_isolates_accounts(client, db_session, inventory_api, monkeypatch):
    remote = dict(buys=[order()], sells=[order(2)], delivery=dict(coins=100, items=[dict(id=2, count=3), dict(id=2, count=4)]))
    monkeypatch.setattr(GW2Client, "fetch_current_orders", lambda self, key, side: remote[side])
    monkeypatch.setattr(GW2Client, "fetch_delivery", lambda self, key: remote["delivery"])
    def sync(key, include=True):
        return AccountService(db_session).sync_holdings(key, key, include_inventory=True, include_trading_post=include)
    sync("A"); sync("B")
    status = client.get("/api/account/trading-post?account_id=A").json()
    assert status["fresh"] and status["delivery"]["items"][0]["quantity"] == 7
    assert status["committed_gold"] == 90
    assert db_session.get(AccountHolding, ("A", 2)).total_count == 20  # TP is never inventory
    previous = db_session.get(AccountTradingPost, "A").payload
    remote["buys"] = [order(), order()]
    result = sync("A")
    assert result["trading_post_status"] == "error"
    assert db_session.get(AccountTradingPost, "A").payload == previous
    assert not client.get("/api/account/trading-post?account_id=A").json()["fresh"]
    assert client.get("/api/account/trading-post?account_id=B").json()["fresh"]
    remote.update(buys=[], sells=[], delivery=dict(coins=0, items=[]))
    sync("A")
    status = client.get("/api/account/trading-post?account_id=A").json()
    assert status["fresh"] and status["buys"] == [] and status["delivery"]["items"] == []
    sync("A", include=False)
    assert not client.get("/api/account/trading-post?account_id=A").json()["fresh"]
    assert client.get("/api/account/trading-post?account_id=unknown").status_code == 404


def test_permission_failure_is_optional_and_identity_mismatch_does_not_touch_orders(client, db_session, inventory_api, monkeypatch):
    def denied(*args):
        response = httpx.Response(403, request=httpx.Request("GET", "https://api.guildwars2.com"))
        raise httpx.HTTPStatusError("private remote error", request=response.request, response=response)
    monkeypatch.setattr(GW2Client, "fetch_current_orders", denied)
    response = client.post("/api/account/sync/holdings", json=dict(api_key="A", account_id="A", include_crafting=False, include_trading_post=True))
    assert response.status_code == 200 and response.json()["trading_post_status"] == "error"
    assert "tradingpost permission" in response.json()["trading_post_error"]
    assert "private remote error" not in response.text
    before = db_session.get(AccountProfile, "A").snapshot_id
    response = client.post("/api/account/sync/holdings", json=dict(api_key="B", account_id="A", include_trading_post=True))
    assert response.status_code == 409 and db_session.get(AccountProfile, "A").snapshot_id == before


@pytest.mark.parametrize("kind", ["valid", "changed_total", "short", "duplicate", "missing_headers"])
def test_paginated_orders_require_complete_consistent_pages(monkeypatch, kind):
    calls = []
    def handle(request):
        assert request.headers["Authorization"] == "Bearer test-only"
        assert "test-only" not in str(request.url)
        page = int(request.url.params["page"])
        calls.append(page)
        rows = [order(i + 1) for i in range(200)] if page == 0 else [order(201)]
        if kind == "short" and page: rows = []
        if kind == "duplicate" and page: rows = [order(1)]
        total = 202 if kind == "changed_total" and page else 201
        headers = {} if kind == "missing_headers" else {"X-Page-Total":"2", "X-Result-Total":str(total)}
        return httpx.Response(200, json=rows, headers=headers)
    real_client = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kw: real_client(**kw, transport=httpx.MockTransport(handle)))
    if kind == "valid":
        assert len(normalize_orders(GW2Client().fetch_current_orders("test-only", "buys"))) == 201
        assert calls == [0, 1]
    else:
        with pytest.raises(ValueError):
            normalize_orders(GW2Client().fetch_current_orders("test-only", "buys"))


def test_migration_adds_trading_post_without_replacing_existing_tables(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'upgrade.sqlite'}")
    migrate(engine)
    with engine.begin() as conn:
        conn.exec_driver_sql("DROP TABLE account_trading_post")
        conn.exec_driver_sql("DELETE FROM schema_migrations WHERE version=4")
        conn.exec_driver_sql("INSERT INTO account_profiles (id,display_name,verified,source,coverage,reservation_revision) VALUES ('A','A',1,'api','{}',7)")
    migrate(engine); migrate(engine)
    assert "account_trading_post" in inspect(engine).get_table_names()
    with engine.connect() as conn:
        assert conn.exec_driver_sql("SELECT reservation_revision FROM account_profiles WHERE id='A'").scalar() == 7
    engine.dispose()


@pytest.mark.parametrize("kind", ["malformed", "failed", "no_bids"])
def test_order_targets_fail_closed_without_cached_price_fallback(db_session, kind):
    setup(db_session)
    trading(db_session, buys=[], pickups=[])
    def unavailable(item):
        data = book(item)
        if item == 2:
            if kind == "failed": raise httpx.ConnectError("Unavailable")
            if kind == "malformed": data["buys"][0]["unit_price"] = True
            if kind == "no_bids": data["buys"] = []
        return data
    assert plan(db_session, provider=unavailable)["status"] != "quoted"


def test_concurrent_reservation_change_rejects_individual_order_quote(client, db_session, monkeypatch):
    setup(db_session, stock=1)
    trading(db_session)
    changed = []
    def changing(self, item):
        if not changed:
            changed.append(True)
            set_reservation(db_session, "A", 2, 1, "Changed during quote", 0)
        return book(item)
    monkeypatch.setattr(GW2Client, "fetch_commerce_listing", changing)
    response = client.get("/api/profit/1/plan", params=dict(account_id="A", material_pricing="buy", output_pricing="buy", use_trading_post=True, check_depth=True))
    assert response.status_code == 409


def test_supply_transition_uses_new_snapshot_without_counting_pickups_twice(client, db_session, inventory_api, monkeypatch):
    monkeypatch.setattr(GW2Client, "fetch_current_orders", lambda *args: [])
    remote = dict(coins=0, items=[dict(id=2, count=4)])
    monkeypatch.setattr(GW2Client, "fetch_delivery", lambda *args: remote)
    service = AccountService(db_session)
    service.sync_holdings("A", "A", include_inventory=True, include_trading_post=True)
    before = db_session.get(AccountHolding, ("A", 2)).total_count
    inventory_api["materials"][0]["count"] += 4
    remote["items"] = []
    service.sync_holdings("A", "A", include_inventory=True, include_trading_post=True)
    status = client.get("/api/account/trading-post?account_id=A").json()
    assert status["fresh"] and status["delivery"]["items"] == []
    assert db_session.get(AccountHolding, ("A", 2)).total_count == before + 4
