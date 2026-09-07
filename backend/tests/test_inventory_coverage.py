from datetime import datetime, timedelta, timezone
import json

import httpx
import pytest
from sqlalchemy import create_engine, text

from app.db.migrations import migrate
from app.models import AccountProfile, AccountHolding, MaterialReservation
from app.models.account_profile import AccountStack
from app.services.account_service import AccountService
from app.services.gw2_client import GW2Client
from app.services.inventory_coverage import inventory_coverage
from app.services.profit_engine import ProfitEngine
from app.services.reservation_service import set_reservation
from test_api_endpoints import db_session, client, seed_simple_recipe


@pytest.fixture
def inventory_api(monkeypatch):
    data = dict(materials=[dict(id=2, count=2)], bank=[None, dict(id=2, count=3)],
                shared=[dict(id=2, count=4), None], names=["Crafter A", "Empty"],
                characters={"Crafter A": dict(bags=[None, dict(id=999, size=3, inventory=[
                    dict(id=2, count=5), None, dict(id=2, count=6, binding="Character", bound_to="Crafter A")])],
                    equipment=[dict(id=2, count=1000)]), "Empty": dict(bags=[None])})
    # No unmocked authenticated request may leave a test.
    def unexpected(*args, **kwargs):
        raise AssertionError("Unexpected remote request")
    monkeypatch.setattr(GW2Client, "_get", unexpected)
    monkeypatch.setattr(GW2Client, "fetch_account", lambda self, key: dict(id=key))
    monkeypatch.setattr(GW2Client, "fetch_account_materials", lambda self, key: data["materials"])
    monkeypatch.setattr(GW2Client, "fetch_account_bank", lambda self, key: data["bank"])
    monkeypatch.setattr(GW2Client, "fetch_shared_inventory", lambda self, key: data["shared"])
    monkeypatch.setattr(GW2Client, "fetch_character_names", lambda self, key: data["names"])
    monkeypatch.setattr(GW2Client, "fetch_character_inventory", lambda self, key, name: data["characters"][name])
    return data


def sync(db, account_id="A"):
    return AccountService(db).sync_holdings(account_id, account_id, include_inventory=True)


def test_sources_sum_once_and_bound_or_equipped_items_are_not_allocated(db_session, inventory_api):
    seed_simple_recipe(db_session)
    result = sync(db_session)
    row = db_session.get(AccountHolding, ("A", 2))
    assert (row.material_count, row.bank_count, row.shared_count, row.character_count) == (2, 3, 4, 11)
    assert (row.total_count, row.usable_count, result["total_owned"]) == (20, 14, 20)
    assert db_session.query(AccountStack).count() == 5
    assert db_session.query(AccountStack).filter_by(source="character:Crafter A", position="1:2").one().bound_to == "Crafter A"
    set_reservation(db_session, "A", 2, 3, "Keep", 0)
    engine = ProfitEngine(db_session, "A")
    assert engine.get_owned_count(2) == 11
    assert sum(r["quantity"] for r in engine.owned_locations(2, 11)) == 11
    assert inventory_coverage(engine.profile)["complete"]


def test_moved_stacks_empty_sources_and_deleted_characters_replace_without_duplication(db_session, inventory_api):
    seed_simple_recipe(db_session)
    sync(db_session)
    sync(db_session, "B")
    set_reservation(db_session, "A", 2, 2, "Keep", 0)
    inventory_api.update(materials=[dict(id=2, count=14)], bank=[], shared=[], names=["Empty"])
    sync(db_session)
    assert db_session.get(AccountHolding, ("A", 2)).total_count == 14
    assert db_session.get(AccountHolding, ("B", 2)).total_count == 20
    assert db_session.query(AccountStack).filter_by(account_id="A").count() == 1
    assert "character:Crafter A" not in json.loads(db_session.get(AccountProfile, "A").coverage)
    assert db_session.get(MaterialReservation, ("A", 2)).quantity == 2
    assert ProfitEngine(db_session, "A").get_owned_count(2) == 12


def test_repeated_material_categories_count_one_vault_balance(db_session, inventory_api):
    inventory_api["materials"] = [dict(id=2, count=2, category=5), dict(id=2, count=2, category=49),
                                  dict(id=3, count=0, category=5), dict(id=3, count=0, category=49),
                                  dict(id=4, count=8, category=5, binding="Account"),
                                  dict(id=4, count=8, category=49, binding="Account")]
    sync(db_session)
    assert db_session.get(AccountHolding, ("A", 2)).material_count == 2
    assert db_session.get(AccountHolding, ("A", 2)).total_count == 20
    assert db_session.get(AccountHolding, ("A", 3)) is None
    bound = db_session.get(AccountHolding, ("A", 4))
    assert (bound.material_count, bound.usable_count) == (8, 0)
    assert db_session.query(AccountStack).filter_by(account_id="A", source="materials").count() == 2


@pytest.mark.parametrize("conflicting", [dict(count=3), dict(count=0), dict(binding="Account"), dict(bound_to="Other")])
def test_conflicting_material_duplicates_preserve_previous_snapshot(db_session, inventory_api, conflicting):
    sync(db_session)
    original = db_session.get(AccountProfile, "A").snapshot_id
    inventory_api["materials"] = [dict(id=2, count=2, category=5), dict(id=2, count=2, category=49) | conflicting]
    with pytest.raises(ValueError, match="Conflicting material entries"):
        sync(db_session)
    assert db_session.get(AccountProfile, "A").snapshot_id == original
    assert db_session.get(AccountHolding, ("A", 2)).total_count == 20


@pytest.mark.parametrize("failure", ["shared", "bag", "roster", "binding", "network"])
def test_incomplete_full_refresh_preserves_snapshot_and_all_sources(db_session, inventory_api, monkeypatch, failure):
    sync(db_session)
    original = db_session.get(AccountProfile, "A").snapshot_id
    inventory_api["materials"] = [dict(id=2, count=100)]
    if failure == "shared":
        inventory_api["shared"] = {"unexpected": []}
    elif failure == "bag":
        inventory_api["characters"]["Empty"] = dict(bags=[dict(id=99, size=4, inventory=[None])])
    elif failure == "roster":
        inventory_api["names"] = ["Empty", "Empty"]
    elif failure == "binding":
        inventory_api["shared"] = [dict(id=2, count=10, binding={})]
    else:
        def fail(*args):
            raise httpx.RequestError("offline")
        monkeypatch.setattr(GW2Client, "fetch_character_inventory", fail)
    with pytest.raises((ValueError, httpx.RequestError)):
        sync(db_session)
    assert db_session.get(AccountProfile, "A").snapshot_id == original
    assert db_session.get(AccountHolding, ("A", 2)).total_count == 20
    assert db_session.query(AccountStack).filter_by(account_id="A").count() == 5


def test_partial_source_refresh_preserves_other_locations_but_cannot_refresh_their_age(db_session, inventory_api):
    seed_simple_recipe(db_session)
    sync(db_session)
    profile = db_session.get(AccountProfile, "A")
    coverage = json.loads(profile.coverage)
    coverage["shared"]["fetched_at"] = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    profile.coverage = json.dumps(coverage)
    db_session.commit()
    inventory_api["materials"] = []
    AccountService(db_session).sync_holdings("A")
    assert db_session.get(AccountHolding, ("A", 2)).total_count == 18
    engine = ProfitEngine(db_session, "A")
    assert engine.holdings_are_stale()
    assert inventory_coverage(engine.profile)["missing_or_stale"] == ["shared"]


def test_api_default_collects_extended_inventory_and_reports_coverage(client, inventory_api):
    response = client.post("/api/account/sync/holdings", json=dict(api_key="A", include_crafting=False))
    assert response.status_code == 200
    assert response.json()["shared_items"] == 1
    status = client.get("/api/account/holdings/status", params=dict(account_id="A")).json()
    assert status["inventory_coverage"]["complete"]


def test_character_inventory_name_is_encoded(monkeypatch):
    calls = []
    monkeypatch.setattr(GW2Client, "_get", lambda self, path, **kw: calls.append(path))
    GW2Client().fetch_character_inventory("key", "A Name/#?")
    assert calls == ["/v2/characters/A%20Name%2F%23%3F/inventory"]


def test_v3_migration_preserves_v2_holdings_and_is_repeatable(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'v2.sqlite'}")
    with engine.begin() as db:
        db.exec_driver_sql("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY)")
        db.exec_driver_sql("INSERT INTO schema_migrations VALUES (1), (2)")
        db.exec_driver_sql("CREATE TABLE account_holdings (account_id TEXT, item_id INTEGER, material_count INTEGER, bank_count INTEGER, total_count INTEGER, usable_count INTEGER, last_updated DATETIME, PRIMARY KEY(account_id,item_id))")
        db.exec_driver_sql("INSERT INTO account_holdings VALUES ('A',2,3,4,7,7,'2026-09-01')")
    migrate(engine)
    migrate(engine)
    with engine.connect() as db:
        assert tuple(db.execute(text("SELECT total_count, usable_count, shared_count, character_count FROM account_holdings")).one()) == (7, 7, 0, 0)
        assert list(db.execute(text("SELECT version FROM schema_migrations ORDER BY version"))) == [(1,), (2,), (3,), (4,)]
    engine.dispose()
