from datetime import datetime, timedelta, timezone
import json

import httpx
import pytest
from sqlalchemy import create_engine, inspect, text, event

from app.db.migrations import migrate
from app.models import AccountProfile, AccountHolding, AccountStack, CommercePrice
from app.models.account_profile import LEGACY_ACCOUNT_ID
from app.services.account_service import AccountService, AccountMismatch
from app.services.craft_planner import CraftPlanner
from app.services.profit_engine import ProfitEngine
from app.services.gw2_client import GW2Client
from test_profit_engine import db_session, add_item, add_price, add_recipe, seed_simple_recipe


def test_concurrent_older_snapshot_cannot_replace_newer(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from sqlalchemy.orm import Session
    from app.services.account_service import InventorySnapshot
    engine = create_engine(f"sqlite:///{tmp_path / 'concurrent.sqlite'}", connect_args={"check_same_thread": False})
    migrate(engine)
    now = datetime.now(timezone.utc)
    attempted = Event()
    snapshot = lambda at, n: InventorySnapshot("A", "A", at,
        [dict(source="materials", position="2", item_id=2, count=n, binding=None, bound_to=None)], {})
    with Session(engine) as writer:
        AccountService(writer).replace_snapshot(snapshot(now - timedelta(minutes=2), 1))
        writer.execute(text("UPDATE account_profiles SET id=id WHERE id='A'"))
        def older_refresh():
            with Session(engine) as reader:
                reader.get(AccountProfile, "A")  # An old identity-map version must not win either.
                attempted.set()
                with pytest.raises(ValueError, match="newer snapshot"):
                    AccountService(reader).replace_snapshot(snapshot(now - timedelta(minutes=1), 2))
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(older_refresh)
            assert attempted.wait(5)
            AccountService(writer).replace_snapshot(snapshot(now, 3))
            future.result(timeout=5)
        writer.expire_all()
        assert writer.get(AccountHolding, ("A", 2)).total_count == 3
    engine.dispose()


def test_quote_snapshot_id_and_stock_stay_together_during_refresh(tmp_path):
    from sqlalchemy.orm import Session
    from app.services.account_service import InventorySnapshot
    engine = create_engine(f"sqlite:///{tmp_path / 'quote-refresh.sqlite'}")
    migrate(engine)
    now = datetime.now(timezone.utc)
    snapshot = lambda n, at: InventorySnapshot("A", "A", at,
        [dict(source="materials", position="2", item_id=2, count=n, binding=None, bound_to=None)], {})
    with Session(engine) as writer:
        seed_simple_recipe(writer)
        old_id = AccountService(writer).replace_snapshot(snapshot(1, now))["snapshot_id"]
        fired = False
        def refresh_during_public_load(conn, cursor, statement, parameters, context, executemany):
            nonlocal fired
            if not fired and "FROM items" in statement:
                fired = True
                AccountService(writer).replace_snapshot(snapshot(4, now + timedelta(seconds=1)))
        event.listen(engine, "before_cursor_execute", refresh_during_public_load)
        with Session(engine) as reader:
            quote = CraftPlanner(ProfitEngine(reader, "A")).build(1, use_owned=True)
            assert fired
            assert quote["snapshot_id"] == old_id
            assert quote["purchase_cost"] == 250
        event.remove(engine, "before_cursor_execute", refresh_during_public_load)
    engine.dispose()


def test_discipline_selects_best_matching_variant(db_session):
    from app.models import Recipe
    seed_simple_recipe(db_session)
    add_recipe(db_session, 99, 1, [(2, 1)])
    db_session.flush()
    db_session.get(Recipe, 99).disciplines = '["Chef"]'
    db_session.commit()
    engine = ProfitEngine(db_session)
    assert engine.calculate_profit_table()[0]["recipe_id"] == 99
    assert engine.calculate_profit_table(discipline="Artificer")[0]["recipe_id"] == 1
    assert engine.calculate_profit_table(discipline="Chef")[0]["recipe_id"] == 99
    assert engine.calculate_profit_table(discipline="Weaponsmith") == []


def test_multi_output_table_values_are_per_output_and_plan_totals(db_session):
    from app.models import Recipe
    seed_simple_recipe(db_session)
    db_session.get(Recipe, 1).output_item_count = 5
    db_session.commit()
    result = ProfitEngine(db_session).calculate_profit(1)
    plan = result["market_plan"]
    assert result["craft_cost"] * 5 == plan["purchase_cost"] == 350
    assert result["crafted_item_value"] == result["net_sale"] == 850
    assert result["ingredient_sale_value"] == 104
    assert result["value_add"] == 746
    assert sum(row["total_cost"] for row in result["ingredients"]) == 350
    assert plan["net_revenue"] == 4250


@pytest.mark.parametrize("extra,complete,reason", [
    ({"ingredients": [{"type": "Item", "id": 2, "count": 2}]}, True, None),
    ({"ingredients": [{"type": "Item", "id": 2, "count": 2}, {"type": "Currency", "id": 23, "count": 1}]}, True, "Non-item"),
    ({"guild_ingredients": [{"upgrade_id": 1, "count": 1}]}, True, "Guild"),
    ({"ingredients": [{"item_id": 2, "count": 2}, {"item_id": 3, "count": -1}]}, False, None),
])
def test_recipe_refresh_never_ignores_unsupported_costs(db_session, monkeypatch, extra, complete, reason):
    from app.models import Recipe
    from app.services.sync_service import SyncService
    seed_simple_recipe(db_session)
    service = SyncService(db_session)
    data = dict(id=1, output_item_id=1, output_item_count=1, min_rating=400,
                flags=["AutoLearned"], type="Refinement", disciplines=["Artificer"],
                ingredients=[{"item_id": 2, "count": 2}]) | extra
    monkeypatch.setattr(service.client, "fetch_all_recipe_ids", lambda: [1])
    monkeypatch.setattr(service.client, "fetch_recipes_by_ids", lambda ids: [data])
    service.sync_recipes()
    db_session.expire_all()
    recipe = db_session.get(Recipe, 1)
    assert recipe.min_rating == 400 and recipe.flags == '["AutoLearned"]'
    assert recipe.ingredients_complete == complete
    assert (reason in recipe.unsupported_reason) if reason else recipe.unsupported_reason is None
    quote = CraftPlanner(ProfitEngine(db_session)).build(1)
    assert quote["purchase_cost"] == (200 if complete and not reason else None)


def test_recipe_client_requests_typed_schema(monkeypatch):
    client = GW2Client()
    calls = []
    monkeypatch.setattr(client, "_get", lambda path, **kwargs: calls.append((path, kwargs)))
    client.fetch_recipes_by_ids([1])
    assert calls == [("/v2/recipes", {"params": {"ids": "1", "v": "latest"}})]


def test_depth_lookup_limit_and_network_failure_produce_unknown(db_session):
    seed_simple_recipe(db_session)
    engine = ProfitEngine(db_session)
    planner = CraftPlanner(engine, "buy", "buy", listing_provider=lambda i: {"buys": [{"unit_price": 500, "quantity": 20}]})
    planner.books = {i: {} for i in range(100, 140)}
    result = planner.build(1)
    assert result["status"] == "incomplete" and result["economic_gain"] is None
    assert any("limit" in issue for issue in result["issues"])
    def fail(item_id):
        raise httpx.RequestError("offline")
    result = CraftPlanner(engine, "sell", "buy", listing_provider=fail).build(1)
    assert result["status"] == "unavailable" and result["purchase_cost"] is None


def profile(db, account_id="A"):
    db.add(AccountProfile(id=account_id, display_name=account_id, verified=True,
                          last_updated=datetime.now(timezone.utc), snapshot_id="snapshot-" + account_id))
    db.commit()


def holding(db, item, count, account_id="A"):
    db.add(AccountHolding(account_id=account_id, item_id=item, total_count=count,
                          material_count=count, bank_count=0, usable_count=count,
                          last_updated=datetime.now(timezone.utc)))
    db.commit()


def test_account_switch_and_second_key_preserve_other_accounts(db_session, monkeypatch):
    monkeypatch.setattr(GW2Client, "fetch_account", lambda self, key: {"id": key[0], "name": key[0]})
    monkeypatch.setattr(GW2Client, "fetch_account_materials", lambda self, key: [{"id": 2, "count": 7 if key[0] == "A" else 11}])
    monkeypatch.setattr(GW2Client, "fetch_account_bank", lambda self, key: [None])
    service = AccountService(db_session)
    service.sync_holdings("A-key")
    service.sync_holdings("B-key")
    service.sync_holdings("A-other-key", "A")
    assert db_session.query(AccountProfile).count() == 2
    assert db_session.get(AccountHolding, ("A", 2)).total_count == 7
    assert db_session.get(AccountHolding, ("B", 2)).total_count == 11
    assert db_session.query(AccountStack).count() == 2
    with pytest.raises(AccountMismatch):
        service.sync_holdings("B-key", "A")


def test_failed_or_malformed_refresh_keeps_last_snapshot(db_session, monkeypatch):
    service = AccountService(db_session)
    monkeypatch.setattr(service.client, "fetch_account", lambda key: {"id": "A", "name": "A"})
    monkeypatch.setattr(service.client, "fetch_account_materials", lambda key: [{"id": 2, "count": 7}])
    monkeypatch.setattr(service.client, "fetch_account_bank", lambda key: [])
    service.sync_holdings("key")
    original = db_session.get(AccountProfile, "A").snapshot_id
    def fail(key):
        raise httpx.RequestError("offline")
    monkeypatch.setattr(service.client, "fetch_account_bank", fail)
    with pytest.raises(httpx.RequestError):
        service.sync_holdings("key", "A")
    monkeypatch.setattr(service.client, "fetch_account_bank", lambda key: [{"id": 3, "count": -1}])
    with pytest.raises(ValueError):
        service.sync_holdings("key", "A")
    assert db_session.get(AccountProfile, "A").snapshot_id == original
    assert db_session.get(AccountHolding, ("A", 2)).total_count == 7


def test_binding_and_location_replacement_are_preserved(db_session, monkeypatch):
    service = AccountService(db_session)
    monkeypatch.setattr(service.client, "fetch_account", lambda key: {"id": "A"})
    monkeypatch.setattr(service.client, "fetch_account_materials", lambda key: [])
    monkeypatch.setattr(service.client, "fetch_account_bank", lambda key: [
        {"id": 2, "count": 4}, {"id": 2, "count": 3, "binding": "Character", "bound_to": "Crafter"}])
    service.sync_holdings("key")
    row = db_session.get(AccountHolding, ("A", 2))
    assert (row.total_count, row.usable_count) == (7, 4)
    assert db_session.query(AccountStack).filter_by(binding="Character").one().bound_to == "Crafter"
    monkeypatch.setattr(service.client, "fetch_account_bank", lambda key: [])
    monkeypatch.setattr(service.client, "fetch_account_materials", lambda key: [{"id": 2, "count": 7}])
    service.sync_holdings("key")
    assert db_session.get(AccountHolding, ("A", 2)).total_count == 7
    assert db_session.query(AccountStack).count() == 1


def legacy_database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.sqlite'}")
    with engine.begin() as db:
        db.exec_driver_sql("CREATE TABLE account_holdings (item_id INTEGER PRIMARY KEY, material_count INTEGER, bank_count INTEGER, total_count INTEGER, last_updated DATETIME)")
        db.exec_driver_sql("INSERT INTO account_holdings VALUES (2, 3, 4, 7, '2026-07-01')")
        db.exec_driver_sql("CREATE TABLE recipes (id INTEGER PRIMARY KEY, output_item_id INTEGER, output_item_count INTEGER, disciplines TEXT)")
        db.exec_driver_sql("INSERT INTO recipes VALUES (1, 1, 1, '[]')")
        db.exec_driver_sql("CREATE TABLE public_sentinel (value TEXT)")
        db.exec_driver_sql("INSERT INTO public_sentinel VALUES ('keep')")
    return engine


def test_migration_quarantines_legacy_and_is_idempotent(tmp_path):
    engine = legacy_database(tmp_path)
    migrate(engine)
    migrate(engine)
    with engine.connect() as db:
        row = db.execute(text("SELECT account_id, total_count, usable_count FROM account_holdings")).one()
        assert tuple(row) == (LEGACY_ACCOUNT_ID, 7, 0)
        assert db.execute(text("SELECT total_count FROM account_holdings_legacy_v0")).scalar() == 7
        assert db.execute(text("SELECT ingredients_complete FROM recipes")).scalar() == 0
        assert db.execute(text("SELECT value FROM public_sentinel")).scalar() == "keep"
        assert db.execute(text("SELECT count(*) FROM schema_migrations")).scalar() == 3
    engine.dispose()


def test_failed_migration_rolls_back_ddl(tmp_path):
    engine = legacy_database(tmp_path)
    def fail(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO account_holdings "):
            raise RuntimeError("injected failure")
    event.listen(engine, "before_cursor_execute", fail)
    with pytest.raises(RuntimeError):
        migrate(engine)
    event.remove(engine, "before_cursor_execute", fail)
    assert "account_id" not in {c["name"] for c in inspect(engine).get_columns("account_holdings")}
    with engine.connect() as db:
        assert db.execute(text("SELECT total_count FROM account_holdings")).scalar() == 7
    engine.dispose()


@pytest.mark.parametrize("materials,output", [("buy", "buy"), ("buy", "sell"), ("sell", "buy"), ("sell", "sell")])
def test_all_modes_share_cost_breakdown_and_liquidation(db_session, materials, output):
    seed_simple_recipe(db_session)
    engine = ProfitEngine(db_session)
    result = engine.calculate_profit(1, materials, output)
    plan = CraftPlanner(engine, materials, output).build(1)
    assert sum(row["total_cost"] for row in result["ingredients"]) == plan["purchase_cost"]
    assert result["craft_cost"] * result["output_item_count"] == plan["purchase_cost"]
    assert result["crafted_item_value"] == plan["net_revenue"]
    assert result["ingredient_sale_value"] == (299 if output == "buy" else 520)
    assert result["recipe_id"] == plan["recipe_id"]


def test_alternative_recipe_and_unique_table_rows(db_session):
    seed_simple_recipe(db_session)
    add_recipe(db_session, 99, 1, [(2, 1)])
    db_session.commit()
    engine = ProfitEngine(db_session)
    result = engine.calculate_profit(1)
    assert result["recipe_id"] == 99
    assert result["craft_cost"] == 100
    assert [r["item_id"] for r in engine.calculate_profit_table()] == [1]


def test_cycle_terminates_and_market_fallback_remains_available(db_session):
    for i in (1, 2):
        add_item(db_session, i, str(i))
        add_price(db_session, i, 100, 200)
    add_recipe(db_session, 1, 1, [(2, 1)])
    add_recipe(db_session, 2, 2, [(1, 1)])
    db_session.commit()
    planner = CraftPlanner(ProfitEngine(db_session))
    plan = planner.build(1)
    assert plan["purchase_cost"] == 100
    db_session.query(CommercePrice).delete()
    db_session.commit()
    assert CraftPlanner(ProfitEngine(db_session)).build(1)["status"] == "unavailable"


def test_whole_intermediate_batches_and_leftovers(db_session):
    for i in (1, 2, 3):
        add_item(db_session, i, str(i))
    add_price(db_session, 1, 400, 500)
    add_price(db_session, 2, 50, 60)
    add_price(db_session, 3, 100, 120)
    add_recipe(db_session, 1, 1, [(2, 1)])
    add_recipe(db_session, 2, 2, [(3, 1)], output_item_count=10)
    db_session.commit()
    planner = CraftPlanner(ProfitEngine(db_session))
    small = planner.build(1)
    assert small["purchase_cost"] == 50
    assert small["purchases"][0]["item_id"] == 2
    larger = planner.build(1, 3)
    assert larger["purchase_cost"] == 100
    assert larger["leftovers"] == [{"item_id": 2, "name": "2", "quantity": 7}]


def test_shared_ingredients_and_surplus_are_allocated_once(db_session):
    # Two intermediate branches each need three components; one component batch makes ten.
    for i in range(1, 6):
        add_item(db_session, i, str(i))
    add_price(db_session, 1, 1000, 1200)
    add_price(db_session, 5, 100, 120)
    add_recipe(db_session, 1, 1, [(2, 1), (3, 1)])
    add_recipe(db_session, 2, 2, [(4, 3)])
    add_recipe(db_session, 3, 3, [(4, 3)])
    add_recipe(db_session, 4, 4, [(5, 1)], output_item_count=10)
    db_session.commit()
    plan = CraftPlanner(ProfitEngine(db_session)).build(1)
    assert plan["purchase_cost"] == 100
    assert plan["leftovers"] == [{"item_id": 4, "name": "4", "quantity": 4}]
    assert sum(s["runs"] for s in plan["steps"] if s["recipe_id"] == 4) == 1


def test_owned_stock_is_scoped_consumed_once_and_has_opportunity_cost(db_session):
    seed_simple_recipe(db_session)
    profile(db_session, "A")
    profile(db_session, "B")
    holding(db_session, 2, 1, "A")
    holding(db_session, 2, 20, "B")
    a = CraftPlanner(ProfitEngine(db_session, "A"), "buy", "buy").build(1, 2, True)
    assert a["consumed"][0]["quantity"] == 1
    assert a["purchase_cost"] == 600
    assert a["owned_sale_value"] == 85
    assert a["economic_gain"] == a["cash_surplus"] - 85
    anonymous = CraftPlanner(ProfitEngine(db_session)).build(1, use_owned=True)
    assert anonymous["consumed"] == []
    with pytest.raises(ValueError):
        ProfitEngine(db_session, LEGACY_ACCOUNT_ID)


def test_zero_and_missing_quotes_never_become_free_inputs(db_session):
    seed_simple_recipe(db_session)
    db_session.get(CommercePrice, 2).buy_price = 0
    db_session.get(CommercePrice, 2).buy_quantity = 0
    db_session.commit()
    assert CraftPlanner(ProfitEngine(db_session)).build(1)["purchase_cost"] is None


def test_output_requires_only_selected_price_side(db_session):
    seed_simple_recipe(db_session)
    db_session.get(CommercePrice, 1).sell_price = None
    db_session.commit()
    assert ProfitEngine(db_session).calculate_profit(1, output_pricing="buy")["net_sale"] == 425
    db_session.get(CommercePrice, 1).buy_price = None
    db_session.commit()
    assert ProfitEngine(db_session).calculate_profit(1, output_pricing="buy") is None


def test_missing_liquidation_is_unknown_not_zero(db_session):
    seed_simple_recipe(db_session)
    db_session.get(CommercePrice, 2).sell_price = None
    db_session.commit()
    result = ProfitEngine(db_session).calculate_profit(1)
    assert result["ingredient_sale_value"] is None
    assert result["recommendation"] == "Unknown"


def test_material_and_output_depth_and_budget(db_session):
    for i in (1, 2):
        add_item(db_session, i, str(i))
    add_price(db_session, 1, 400, 500)
    add_price(db_session, 2, 90, 100)
    add_recipe(db_session, 1, 1, [(2, 1)])
    db_session.commit()
    books = {
        2: {"sells": [{"unit_price": 100, "quantity": 1}, {"unit_price": 200, "quantity": 1}]},
        1: {"buys": [{"unit_price": 400, "quantity": 1}, {"unit_price": 350, "quantity": 1}]},
    }
    planner = CraftPlanner(ProfitEngine(db_session), "sell", "buy", listing_provider=books.__getitem__)
    result = planner.build(1, 2, budget=336)
    assert result["purchase_cost"] == 300
    assert result["net_revenue"] == 638
    assert result["additional_gold_needed"] == 337
    assert result["within_budget"] is False
    assert planner.build(1, 3)["purchase_cost"] is None


def test_insufficient_output_depth_never_multiplies_top_bid(db_session):
    seed_simple_recipe(db_session)
    planner = CraftPlanner(ProfitEngine(db_session), "buy", "buy",
                           listing_provider=lambda item: {"buys": [{"unit_price": 500, "quantity": 1}]})
    result = planner.build(1, 2)
    assert result["status"] == "incomplete"
    assert result["net_revenue"] is None
    assert result["economic_gain"] is None


def test_stale_inputs_and_holdings_are_exposed(db_session):
    seed_simple_recipe(db_session)
    profile(db_session)
    holding(db_session, 2, 1)
    db_session.get(CommercePrice, 3).last_updated = datetime.now(timezone.utc) - timedelta(days=3)
    db_session.get(AccountProfile, "A").last_updated = datetime.now(timezone.utc) - timedelta(days=3)
    db_session.commit()
    result = CraftPlanner(ProfitEngine(db_session, "A")).build(1, use_owned=True)
    assert 3 in result["stale_price_item_ids"]
    assert any("holdings are stale" in issue for issue in result["issues"])
