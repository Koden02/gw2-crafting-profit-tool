from datetime import datetime, timedelta, timezone
import json

import httpx
import pytest

from app.models import AccountProfile, CommercePrice, Recipe
from app.services.batch_recommendations import BatchRecommendations
from app.services.gw2_client import GW2Client
from app.services.profit_engine import ProfitEngine
from app.services.reservation_service import set_reservation
from test_api_endpoints import db_session, client
from test_account_eligibility import account, seed


def setup(db, stock=0):
    seed(db)
    account(db, stock=stock)
    profile = db.get(AccountProfile, "A")
    now = datetime.now(timezone.utc).isoformat()
    profile.coverage = json.dumps({name: dict(status="ok", fetched_at=now, data=["Crafter A"] if name == "character_roster" else [])
                                  for name in ("materials", "bank", "shared", "character_roster", "character:Crafter A")})
    db.commit()


def book(item_id):
    bid, ask = {1: (1000, 1100), 2: (100, 200), 3: (50, 70)}[item_id]
    return dict(id=item_id, buys=[dict(unit_price=bid, quantity=10000)], sells=[dict(unit_price=ask, quantity=10000)])


def finder(db, provider=book):
    return BatchRecommendations(ProfitEngine(db, "A", include_history=False), provider)


def test_budget_includes_upfront_fees_and_totals_use_live_books(db_session):
    setup(db_session)
    result = finder(db_session).find(1320, minimum_gain=1, max_output=10)
    suggestion = result["suggestions"][0]
    plan = suggestion["plan"]
    assert plan["planned_quantity"] == 2
    assert plan["purchase_cost"] == 1220
    assert plan["additional_gold_needed"] == 1320
    assert plan["economic_gain"] == 480
    assert plan["material_pricing"] == "sell" and plan["output_pricing"] == "buy"
    assert suggestion["quantity_limit_reason"] == "The next batch exceeds your budget"
    assert finder(db_session).find(650, 1, 5)["suggestions"] == []


def test_larger_profitable_batch_can_be_worse_than_smaller_batch(db_session):
    setup(db_session)
    def levels(item_id):
        data = book(item_id)
        if item_id == 1:
            data["buys"] = [dict(unit_price=1000, quantity=2), dict(unit_price=700, quantity=3)]
        return data
    result = finder(db_session, levels).find(10000, 1, 5)
    suggestion = result["suggestions"][0]
    assert suggestion["plan"]["planned_quantity"] == 2
    assert suggestion["plan"]["economic_gain"] == 480
    assert result["quantities_checked"] == 5
    assert "do not improve" in suggestion["quantity_limit_reason"]


def test_batch_rounding_obeys_actual_output_cap_and_bid_depth(db_session):
    setup(db_session)
    db_session.get(Recipe, 1).output_item_count = 5
    db_session.commit()
    def limited(item_id):
        data = book(item_id)
        if item_id == 1:
            data["buys"][0]["quantity"] = 9
        return data
    assert finder(db_session, limited).find(10000, 1, 4)["suggestions"] == []
    result = finder(db_session, limited).find(10000, 1, 15)
    assert result["suggestions"][0]["plan"]["planned_quantity"] == 5
    assert "market depth" in result["suggestions"][0]["quantity_limit_reason"]


def test_owned_stock_is_valued_and_reservations_change_selected_batch(db_session):
    setup(db_session, stock=6)
    first = finder(db_session).find(1500, 1, 5)["suggestions"][0]["plan"]
    assert first["planned_quantity"] == 4
    assert first["owned_sale_value"] == 510
    assert first["economic_gain"] == first["cash_surplus"] - 510
    set_reservation(db_session, "A", 2, 6, "Keep all", 0)
    second = finder(db_session).find(1500, 1, 5)["suggestions"][0]["plan"]
    assert second["planned_quantity"] == 2
    assert second["consumed"] == [] and second["reserved"][0]["quantity"] == 6
    assert second["reservation_revision"] == 1


@pytest.mark.parametrize("fault", ["network", "missing_side", "wrong_item", "malformed_level", "thin_materials"])
def test_unverified_or_insufficient_depth_never_returns_cached_profit(db_session, fault):
    setup(db_session)
    def broken(item_id):
        data = book(item_id)
        if fault == "network":
            raise httpx.RequestError("offline")
        if fault == "missing_side":
            data.pop("sells")
        elif fault == "wrong_item":
            data["id"] = 999
        elif fault == "malformed_level":
            data["buys"].append(dict(unit_price=True, quantity=10000))
        elif item_id == 2:
            data["sells"][0]["quantity"] = 1
        return data
    assert finder(db_session, broken).find(10000, 1, 5)["suggestions"] == []


def test_order_books_are_reused_within_search_and_time_limit_is_explicit(db_session, monkeypatch):
    setup(db_session)
    calls = []
    def counting(item_id):
        calls.append(item_id)
        return book(item_id)
    result = finder(db_session, counting).find(100000, 1, 100)
    assert len(calls) == len(set(calls)) == result["books_checked"] == 3
    assert result["suggestions"][0]["plan"]["planned_quantity"] == 100
    monkeypatch.setattr(BatchRecommendations, "MAX_SECONDS", -1)
    result = finder(db_session, counting).find(100000, 1, 100)
    assert result["search_limited"] and not result["suggestions"]
    assert len(calls) == 3


@pytest.mark.parametrize("stale", ["inventory", "price", "crafting", "incomplete_inventory"])
def test_missing_or_stale_account_inputs_cannot_be_recommended(db_session, stale):
    setup(db_session)
    profile = db_session.get(AccountProfile, "A")
    if stale in ("inventory", "incomplete_inventory"):
        coverage = json.loads(profile.coverage)
        if stale == "inventory":
            coverage["shared"]["fetched_at"] = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        else:
            coverage.pop("shared")
        profile.coverage = json.dumps(coverage)
    elif stale == "price":
        db_session.get(CommercePrice, 2).last_updated -= timedelta(hours=2)
    else:
        from test_account_eligibility import change_caps
        change_caps(db_session, lambda data: data["characters"].update(status="error"))
    db_session.commit()
    assert finder(db_session).find(10000, 1, 5)["suggestions"] == []


def test_endpoint_validates_account_and_rejects_a_reservation_change_during_search(client, db_session, monkeypatch):
    setup(db_session, stock=6)
    monkeypatch.setattr(GW2Client, "fetch_commerce_listing", lambda self, item_id: book(item_id))
    payload = dict(account_id="A", budget=1500, minimum_gain=1, max_output=5)
    response = client.post("/api/craft-recommendations", json=payload)
    assert response.status_code == 200 and response.json()["suggestions"]
    assert client.post("/api/craft-recommendations", json={**payload, "account_id":"B"}).status_code == 404
    for invalid in (True, 0, -1, 1.5):
        assert client.post("/api/craft-recommendations", json={**payload, "budget":invalid}).status_code == 422
    changed = []
    def changing(self, item_id):
        if not changed:
            set_reservation(db_session, "A", 2, 6, "Changed", 0)
            changed.append(True)
        return book(item_id)
    monkeypatch.setattr(GW2Client, "fetch_commerce_listing", changing)
    assert client.post("/api/craft-recommendations", json=payload).status_code == 409
