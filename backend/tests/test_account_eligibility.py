from datetime import datetime, timedelta, timezone
import json

import httpx
import pytest
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import Session

from app.db.migrations import migrate
from app.models import AccountProfile, AccountCrafting, AccountHolding, MaterialReservation, Recipe, CommercePrice
from app.services.account_service import AccountService
from app.services.account_crafting_service import collect_crafting
from app.services.craft_planner import CraftPlanner
from app.services.profit_engine import ProfitEngine
from app.services.reservation_service import set_reservation, AccountDataChanged
from app.services.gw2_client import GW2Client
from test_api_endpoints import db_session, client, add_item, add_price, add_recipe, seed_simple_recipe


def source(data, age=0, status="ok"):
    return dict(data=data, fetched_at=(datetime.now(timezone.utc)-timedelta(hours=age)).isoformat(), status=status)


def account(db, account_id="A", known=(1,), names=None, stock=0):
    names = names or {"Crafter " + account_id: dict(crafting=source([dict(discipline="Artificer", rating=500, active=True)]), recipes=source([]))}
    db.add(AccountProfile(id=account_id, display_name=account_id, verified=True, snapshot_id="s"+account_id,
                          last_updated=datetime.now(timezone.utc)))
    db.add(AccountCrafting(account_id=account_id, snapshot_id="s"+account_id,
                          payload=json.dumps(dict(characters=source(list(names)), account_recipes=source(list(known)), by_character=names))))
    if stock:
        db.add(AccountHolding(account_id=account_id, item_id=2, material_count=stock, bank_count=0,
                              total_count=stock, usable_count=stock, last_updated=datetime.now(timezone.utc)))
    db.commit()


def seed(db):
    seed_simple_recipe(db)
    metadata(db, 1)


def metadata(db, recipe_id, flags=("LearnedFromItem",), discipline="Artificer", rating=400):
    recipe = db.get(Recipe, recipe_id)
    recipe.flags = json.dumps(list(flags))
    recipe.min_rating = rating
    recipe.disciplines = json.dumps([discipline])
    recipe.recipe_type = "Component"
    db.commit()


def change_caps(db, change, account_id="A"):
    row = db.get(AccountCrafting, account_id)
    payload = json.loads(row.payload)
    change(payload)
    row.payload = json.dumps(payload)
    db.commit()


def strict_plan(db, account_id="A", **kwargs):
    return CraftPlanner(ProfitEngine(db, account_id), require_eligible=True).build(1, use_owned=True, **kwargs)


@pytest.mark.parametrize("kind", ["account", "character", "automatic"])
def test_known_character_and_automatic_recipes_are_eligible(db_session, kind):
    seed(db_session)
    account(db_session, known=(1,) if kind == "account" else ())
    if kind == "automatic":
        metadata(db_session, 1, flags=("AutoLearned",))
    if kind == "character":
        change_caps(db_session, lambda p: p["by_character"]["Crafter A"].update(recipes=source([1])))
    if kind != "account":
        change_caps(db_session, lambda p: p.update(account_recipes=source([], status="error")))
    result = strict_plan(db_session)
    assert result["eligibility"] == "eligible"
    assert result["steps"][-1]["crafter"] == "Crafter A"
    assert result["steps"][-1]["recipe_state"] == ("automatic" if kind == "automatic" else "known")
    assert result["steps"][-1]["eligible_characters"][0]["unlock_source"] == kind


@pytest.mark.parametrize("case,expected", [("locked", "locked"), ("missing", "unknown"), ("stale", "unknown"), ("inactive", "inactive"), ("low", "level_too_low"), ("metadata", "unknown")])
def test_ineligible_states_are_distinct_and_not_quoted(db_session, case, expected):
    seed(db_session)
    account(db_session, known=() if case in {"locked", "missing"} else (1,))
    if case == "missing":
        change_caps(db_session, lambda p: p.update(account_recipes=source([], status="error")))
    if case == "stale":
        change_caps(db_session, lambda p: p.update(characters=source(["Crafter A"], age=2)))
    if case in {"inactive", "low"}:
        def change(p):
            p["by_character"]["Crafter A"]["crafting"]["data"][0].update(active=case != "inactive", rating=20 if case == "low" else 500)
        change_caps(db_session, change)
    if case == "metadata":
        db_session.get(Recipe, 1).min_rating = None
        db_session.commit()
    engine = ProfitEngine(db_session, "A")
    assert engine.eligibility.evaluate(db_session.get(Recipe, 1))["status"] == expected
    assert CraftPlanner(engine, require_eligible=True).build(1, use_owned=True)["status"] == "unavailable"


def test_one_fresh_character_can_prove_eligibility_despite_another_failed_source(db_session):
    seed(db_session)
    account(db_session)
    def change(p):
        p["characters"]["data"].append("Unavailable character")
        p["by_character"]["Unavailable character"] = dict(crafting=source([], status="error"))
    change_caps(db_session, change)
    assert strict_plan(db_session)["eligibility"] == "eligible"


def test_recipe_selection_filters_before_choosing_cheapest(db_session):
    seed(db_session)
    add_recipe(db_session, 99, 1, [(3, 1)])
    metadata(db_session, 99)
    account(db_session, "A", known=(1,))
    account(db_session, "B", known=(99,))
    assert ProfitEngine(db_session).calculate_profit(1)["recipe_id"] == 99
    assert strict_plan(db_session, "A")["recipe_id"] == 1
    assert strict_plan(db_session, "B")["recipe_id"] == 99
    assert ProfitEngine(db_session, "A").calculate_profit_table(eligible_only=True)[0]["recipe_id"] == 1


def test_locked_intermediate_is_bought_and_known_intermediate_names_its_crafter(db_session):
    seed(db_session)
    add_recipe(db_session, 2, 2, [(3, 1)])
    metadata(db_session, 2, discipline="Tailor")
    account(db_session)
    result = strict_plan(db_session)
    assert result["purchase_cost"] == 350
    assert [s["recipe_id"] for s in result["steps"]] == [1]
    def change(p):
        p["characters"]["data"].append("Tailor A")
        p["by_character"]["Tailor A"] = dict(crafting=source([dict(discipline="Tailor", rating=500, active=True)]), recipes=source([2]))
    change_caps(db_session, change)
    result = strict_plan(db_session)
    assert result["purchase_cost"] == 250
    assert [(s["recipe_id"], s["crafter"]) for s in result["steps"]] == [(2, "Tailor A"), (1, "Crafter A")]


def test_time_gated_route_remains_unknown_even_when_recipe_is_known(db_session):
    seed(db_session)
    db_session.get(Recipe, 1).recipe_type = "RefinementEctoplasm"
    db_session.commit()
    account(db_session)
    result = strict_plan(db_session)
    assert result["status"] == "unavailable"
    assert "Daily crafting allowance" in result["issues"][0]


def test_reservations_are_scoped_clamped_and_shared_across_steps(db_session):
    for i in range(1, 5):
        add_item(db_session, i, f"Item {i}")
        add_price(db_session, i, 1000 if i < 4 else 100, 1500 if i < 4 else 200)
    add_recipe(db_session, 1, 1, [(2, 1), (3, 1)])
    add_recipe(db_session, 2, 2, [(4, 2)])
    add_recipe(db_session, 3, 3, [(4, 2)])
    for i in range(1, 4):
        metadata(db_session, i, flags=("AutoLearned",))
    account(db_session, "A")
    account(db_session, "B")
    for a in ["A", "B"]:
        db_session.add(AccountHolding(account_id=a, item_id=4, total_count=5, usable_count=5, material_count=5, bank_count=0, last_updated=datetime.now(timezone.utc)))
    db_session.commit()
    set_reservation(db_session, "A", 4, 2, "Another goal", 0)
    a, b = strict_plan(db_session, "A"), strict_plan(db_session, "B")
    assert a["consumed"][0]["quantity"] == 3 and a["purchases"][0]["quantity"] == 1
    assert a["reserved"][0]["quantity"] == 2
    assert b["consumed"][0]["quantity"] == 4 and b["purchases"] == []
    set_reservation(db_session, "A", 4, 10, "Future goal", 1)
    a = strict_plan(db_session, "A")
    assert a["consumed"] == [] and a["purchases"][0]["quantity"] == 4
    with pytest.raises(AccountDataChanged):
        set_reservation(db_session, "A", 4, 0, "", 1)
    set_reservation(db_session, "A", 4, 0, "", 2)
    assert db_session.get(MaterialReservation, ("A", 4)) is None


@pytest.mark.parametrize("material_mode,output_mode", [("buy", "sell"), ("buy", "buy"), ("sell", "sell"), ("sell", "buy")])
def test_eligible_api_views_reconcile_account_costs_and_reservations(client, db_session, monkeypatch, material_mode, output_mode):
    seed(db_session)
    account(db_session, stock=2)
    db_session.get(CommercePrice, 1).buy_price = 900
    db_session.commit()
    params = dict(account_id="A", eligible_only=True, material_pricing=material_mode, output_pricing=output_mode)
    monkeypatch.setattr(GW2Client, "fetch_commerce_listing", lambda self, item_id: dict(buys=[dict(unit_price=1000, quantity=50)], sells=[dict(unit_price=1500, quantity=50)]))
    for reserved in (0, 1):
        if reserved:
            assert client.put("/api/account/reservations/2?account_id=A", json=dict(quantity=1, purpose="Other goal", expected_revision=0)).status_code == 200
        row = client.get("/api/profitable-crafts", params=params).json()[0]
        detail = client.get("/api/profit/1", params=params).json()
        plan = client.get("/api/profit/1/plan", params=params).json()
        assert row["quote_basis"] == "account"
        assert row["recipe_id"] == detail["recipe_id"] == plan["recipe_id"]
        assert row["profit"] == detail["profit"] == plan["economic_gain"]
        assert row["craft_cost"] == plan["purchase_cost"] + plan["owned_sale_value"]
        assert row["ingredient_sale_value"] == plan["owned_sale_value"]
        assert row["reservation_revision"] == plan["reservation_revision"] == reserved
        depth = client.get("/api/profit/1/listing-depth", params=params).json()
        assert depth["craft_cost"] == row["craft_cost"]
        scenarios = client.get("/api/profit/1/scenarios", params=params).json()
        scenario = next(r for r in scenarios if r["material_pricing"] == material_mode and r["output_pricing"] == output_mode)
        assert scenario["profit"] == plan["economic_gain"]
    assert client.get("/api/profitable-crafts?eligible_only=true").status_code == 422
    assert client.get("/api/account/crafting?account_id=missing").status_code == 404
    assert client.put("/api/account/reservations/2?account_id=A", json=dict(quantity=-1, expected_revision=1)).status_code == 422
    assert client.put("/api/account/reservations/2?account_id=A", json=dict(quantity=0, expected_revision=0)).status_code == 409
    material = client.get("/api/account/materials?account_id=A&search=Ingredient%20A").json()["rows"][0]
    assert material["reserved"] == 1 and material["available"] == 1


def test_stale_stock_or_prices_excluded_from_eligible_table(db_session):
    from app.models import CommercePrice
    seed(db_session)
    account(db_session)
    db_session.get(CommercePrice, 2).last_updated -= timedelta(hours=2)
    db_session.commit()
    assert ProfitEngine(db_session, "A").calculate_profit_table(eligible_only=True) == []
    assert ProfitEngine(db_session).calculate_profit_table()
    db_session.get(AccountProfile, "A").last_updated -= timedelta(hours=2)
    db_session.commit()
    assert strict_plan(db_session)["status"] == "unavailable"


def test_partial_capability_refresh_preserves_data_but_invalidates_proof(db_session, monkeypatch):
    seed(db_session)
    account(db_session, stock=2)
    set_reservation(db_session, "A", 2, 1, "Keep", 0)
    service = AccountService(db_session)
    monkeypatch.setattr(service.client, "fetch_account", lambda key: dict(id="A"))
    monkeypatch.setattr(service.client, "fetch_account_materials", lambda key: [dict(id=2, count=3)])
    monkeypatch.setattr(service.client, "fetch_account_bank", lambda key: [])
    monkeypatch.setattr(service.client, "fetch_character_names", lambda key: ["Crafter A"])
    monkeypatch.setattr(service.client, "fetch_character_crafting", lambda key, name: dict(crafting=[dict(discipline="Artificer", rating=500, active=True)]))
    def denied(*args):
        request = httpx.Request("GET", "https://api.guildwars2.com/test")
        raise httpx.HTTPStatusError("secret-key-must-not-be-stored", request=request, response=httpx.Response(403, request=request))
    monkeypatch.setattr(service.client, "fetch_account_recipes", denied)
    monkeypatch.setattr(service.client, "fetch_character_recipes", denied)
    service.sync_holdings("key", "A", include_crafting=True)
    stored = db_session.get(AccountCrafting, "A")
    payload = json.loads(stored.payload)
    assert payload["account_recipes"]["data"] == [1] and payload["account_recipes"]["status"] == "error"
    assert "secret-key" not in stored.payload
    assert db_session.get(MaterialReservation, ("A", 2)).quantity == 1
    assert db_session.get(AccountHolding, ("A", 2)).usable_count == 3
    assert stored.snapshot_id == db_session.get(AccountProfile, "A").snapshot_id
    assert strict_plan(db_session)["status"] == "unavailable"


def test_character_names_are_path_encoded(monkeypatch):
    client = GW2Client()
    calls = []
    monkeypatch.setattr(client, "_get", lambda path, **kwargs: calls.append(path))
    client.fetch_character_crafting("key", "A Name/#?")
    assert calls == ["/v2/characters/A%20Name%2F%23%3F/crafting"]


def test_v2_migration_preserves_existing_profile(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'v1.sqlite'}")
    with engine.begin() as db:
        db.exec_driver_sql("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY)")
        db.exec_driver_sql("INSERT INTO schema_migrations VALUES (1)")
        db.exec_driver_sql("CREATE TABLE account_profiles (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, verified BOOLEAN NOT NULL, snapshot_id TEXT, last_updated DATETIME, source TEXT NOT NULL, coverage TEXT NOT NULL)")
        db.exec_driver_sql("INSERT INTO account_profiles VALUES ('A','Keep name',1,'old',NULL,'api','{}')")
    migrate(engine)
    migrate(engine)
    with engine.connect() as db:
        assert db.execute(text("SELECT display_name, snapshot_id, reservation_revision FROM account_profiles")).one() == ("Keep name", "old", 0)
        assert db.execute(text("SELECT count(*) FROM schema_migrations")).scalar() == 3
    assert "account_crafting" in inspect(engine).get_table_names()
    engine.dispose()


def test_reservation_change_during_quote_read_retries_coherent_context(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'race.sqlite'}")
    migrate(engine)
    with Session(engine) as writer:
        seed(writer)
        account(writer, stock=2)
        fired = False
        def change(conn, cursor, statement, parameters, context, executemany):
            nonlocal fired
            if not fired and "FROM material_reservations" in statement and statement.startswith("SELECT"):
                fired = True
                set_reservation(writer, "A", 2, 2, "Changed during read", 0)
        event.listen(engine, "before_cursor_execute", change)
        with Session(engine) as reader:
            plan = strict_plan(reader)
            assert fired and plan["reservation_revision"] == 1
            assert plan["consumed"] == [] and plan["purchase_cost"] == 350
        event.remove(engine, "before_cursor_execute", change)
    engine.dispose()


def test_malformed_capabilities_are_unknown_and_fresh_empty_roster_replaces_old_characters():
    class Client:
        def fetch_character_names(self, key): return ["Crafter"]
        def fetch_character_crafting(self, key, name): return {"crafting": [{"discipline": "Artificer", "rating": 500}]}
        def fetch_character_recipes(self, key, name): return {"recipes": [True]}
        def fetch_account_recipes(self, key): return {"count": 10}
    client = Client()
    payload = collect_crafting(client, "fixture")
    assert payload["account_recipes"]["status"] == "error"
    assert payload["by_character"]["Crafter"]["crafting"]["status"] == "error"
    assert payload["by_character"]["Crafter"]["recipes"]["status"] == "error"
    client.fetch_character_names = lambda key: []
    refreshed = collect_crafting(client, "fixture", payload)
    assert refreshed["characters"]["data"] == [] and refreshed["by_character"] == {}
