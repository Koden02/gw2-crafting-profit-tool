"""Small, transactional SQLite migrations. Public caches are never rebuilt here."""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.db.base import Base
from app.models.account_profile import LEGACY_ACCOUNT_ID
import app.models  # noqa: F401


def migrate(engine: Engine) -> None:
    with engine.connect() as connection:
        # Serialize startup migrations and make SQLite DDL transactional.
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            connection.exec_driver_sql(
                "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)"
            )
            done = connection.execute(text("SELECT version FROM schema_migrations")).scalars().all()
            if 1 not in done:
                tables = inspect(connection).get_table_names()
                legacy = "account_holdings" in tables and "account_id" not in {
                    c["name"] for c in inspect(connection).get_columns("account_holdings")
                }
                if legacy:
                    connection.exec_driver_sql(
                        "ALTER TABLE account_holdings RENAME TO account_holdings_legacy_v0"
                    )
                Base.metadata.create_all(connection)
                if legacy:
                    connection.execute(text(
                        "INSERT INTO account_profiles (id, display_name, verified, source, coverage) "
                        "VALUES (:id, 'Legacy holdings - owner unknown', 0, 'legacy', '{}')"
                    ), {"id": LEGACY_ACCOUNT_ID})
                    connection.execute(text(
                        "INSERT INTO account_holdings "
                        "(account_id, item_id, material_count, bank_count, total_count, usable_count, last_updated) "
                        "SELECT :id, item_id, material_count, bank_count, total_count, 0, last_updated "
                        "FROM account_holdings_legacy_v0"
                    ), {"id": LEGACY_ACCOUNT_ID})
                columns = {c["name"] for c in inspect(connection).get_columns("recipes")}
                for name, declaration in {
                    "min_rating": "INTEGER", "flags": "TEXT", "recipe_type": "TEXT",
                    "ingredients_complete": "BOOLEAN NOT NULL DEFAULT 0",
                    "unsupported_reason": "TEXT",
                }.items():
                    if name not in columns:
                        connection.exec_driver_sql(f"ALTER TABLE recipes ADD COLUMN {name} {declaration}")
                connection.execute(text("INSERT INTO schema_migrations VALUES (1)"))
            Base.metadata.create_all(connection)
            if 2 not in done:
                columns = {c["name"] for c in inspect(connection).get_columns("account_profiles")}
                if "reservation_revision" not in columns:
                    connection.exec_driver_sql("ALTER TABLE account_profiles ADD COLUMN reservation_revision INTEGER NOT NULL DEFAULT 0")
                connection.execute(text("INSERT INTO schema_migrations VALUES (2)"))
            if 3 not in done:
                columns = {c["name"] for c in inspect(connection).get_columns("account_holdings")}
                for name in ("shared_count", "character_count"):
                    if name not in columns:
                        connection.exec_driver_sql(f"ALTER TABLE account_holdings ADD COLUMN {name} INTEGER NOT NULL DEFAULT 0")
                connection.execute(text("INSERT INTO schema_migrations VALUES (3)"))
            if 4 not in done:
                # create_all above adds the isolated Trading Post observation table.
                connection.execute(text("INSERT INTO schema_migrations VALUES (4)"))
            connection.commit()
        except Exception:
            connection.rollback()
            raise
