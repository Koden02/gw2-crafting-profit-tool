"""Identify lock contention without disguising unrelated database failures."""
import sqlite3

from sqlalchemy.exc import OperationalError


def is_database_busy(error: OperationalError) -> bool:
    cause = error.orig
    if not isinstance(cause, sqlite3.OperationalError):
        return False
    code = getattr(cause, "sqlite_errorcode", None)
    if code is not None:
        # Extended results such as SQLITE_BUSY_SNAPSHOT share the low byte.
        return code & 0xFF in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED)
    return str(cause).lower() in {
        "database is locked", "database table is locked", "database schema is locked",
    }
