"""Exercise the production connection setup against real SQLite file locks."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import sqlite3
from threading import Event, Timer

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.dependencies import get_db
from app.db.errors import is_database_busy
from app.db.session import create_database_engine
from app.main import app
from app.models import AccountProfile, Item, MaterialReservation


@pytest.fixture
def file_db(tmp_path, request):
    path = tmp_path / "contention.sqlite"
    options = {"timeout": request.param} if hasattr(request, "param") else {}
    engine = create_database_engine(f"sqlite:///{path.as_posix()}", **options)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False)
    with sessions() as db:
        db.add(AccountProfile(id="A", display_name="Original", verified=True))
        db.add(Item(id=1, name="Test material", flags="[]"))
        db.commit()

    def override_get_db():
        with sessions() as db:
            yield db

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_get_db
    # Do not enter TestClient's lifespan: no real DB startup or auto-sync worker.
    client = TestClient(app, raise_server_exceptions=False)
    try:
        yield path, engine, sessions, client
    finally:
        client.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
        engine.dispose()


@contextmanager
def held_database_lock(path, *, mode="EXCLUSIVE", seconds=None):
    ready, release = Event(), Event()

    def writer():
        with sqlite3.connect(path) as db:
            db.execute(f"BEGIN {mode}")
            db.execute("UPDATE account_profiles SET display_name = 'Uncommitted' WHERE id = 'A'")
            ready.set()
            try:
                if not release.wait(20):
                    raise TimeoutError("Test did not release its writer")
            finally:
                db.rollback()

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(writer)
        timer = None
        try:
            assert ready.wait(5), "Writer did not acquire the lock"
            if seconds is not None:
                timer = Timer(seconds, release.set)
                timer.start()
            yield
        finally:
            release.set()
            if timer:
                timer.cancel()
                timer.join()
            future.result(timeout=5)


def test_every_connection_has_the_longer_busy_timeout(file_db):
    _, engine, _, _ = file_db
    with engine.connect() as first, engine.connect() as second:
        assert first.exec_driver_sql("PRAGMA busy_timeout").scalar() == 30000
        assert second.exec_driver_sql("PRAGMA busy_timeout").scalar() == 30000


def test_trading_post_read_waits_beyond_the_old_five_second_timeout(file_db):
    path, _, _, client = file_db
    assert client.get("/api/account/trading-post", params={"account_id": "A"}).status_code == 200
    # Leave margin for connection setup and scheduling beyond the old timeout.
    with held_database_lock(path, seconds=12):
        response = client.get("/api/account/trading-post", params={"account_id": "A"})
    assert response.status_code == 200
    assert response.json()["account_id"] == "A"
    assert response.json()["buys"] == []
    assert client.get("/api/account/profiles").json()[0]["display_name"] == "Original"


@pytest.mark.parametrize("file_db", [0.05], indirect=True)
def test_exhausted_read_timeout_is_retryable_and_recovers(file_db):
    path, _, _, client = file_db
    with held_database_lock(path):
        response = client.get("/api/account/trading-post", params={"account_id": "A"})
        assert response.status_code == 503
        assert response.headers["Retry-After"] == "5"
        assert response.json() == {"detail": "The local database is busy with another operation. Wait a moment and try again."}
    assert client.get("/api/account/trading-post", params={"account_id": "A"}).status_code == 200


@pytest.mark.parametrize("file_db", [0.05], indirect=True)
def test_exhausted_write_timeout_preserves_reservations_and_can_be_retried(file_db):
    path, _, sessions, client = file_db
    payload = dict(quantity=2, purpose="Keep", expected_revision=0)
    with held_database_lock(path, mode="IMMEDIATE"):
        response = client.put("/api/account/reservations/1?account_id=A", json=payload)
        assert response.status_code == 503
    with sessions() as db:
        assert db.get(AccountProfile, "A").reservation_revision == 0
        assert db.get(MaterialReservation, ("A", 1)) is None
    response = client.put("/api/account/reservations/1?account_id=A", json=payload)
    assert response.status_code == 200
    assert response.json()["reservation_revision"] == 1


def test_unrelated_database_error_is_not_reported_as_contention(file_db):
    _, engine, _, client = file_db
    with engine.begin() as connection:
        connection.exec_driver_sql("DROP TABLE account_profiles")
    response = client.get("/api/account/profiles")
    assert response.status_code == 500
    assert "Retry-After" not in response.headers


@pytest.mark.parametrize("code", [sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED, sqlite3.SQLITE_BUSY_SNAPSHOT])
def test_extended_sqlite_lock_result_codes(code):
    cause = sqlite3.OperationalError("driver detail")
    cause.sqlite_errorcode = code
    assert is_database_busy(OperationalError("private SQL", {}, cause))
