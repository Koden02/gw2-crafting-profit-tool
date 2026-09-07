from pathlib import Path
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

SQLITE_BUSY_TIMEOUT_SECONDS = 30.0


def create_database_engine(database_url: str, *, timeout: float = SQLITE_BUSY_TIMEOUT_SECONDS):
	# History snapshots and account replacement can overlap with UI requests.
	# Apply the wait to every pooled connection, not just the startup connection.
	return create_engine(
		database_url,
		connect_args={"check_same_thread": False, "timeout": timeout},
	)


BASE_DIR = Path(__file__).resolve().parents[3]
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_PATH = Path(os.environ.get("GW2_PROFIT_DATABASE", str(DATA_DIR / "gw2_profit.sqlite"))).resolve()
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
DATABASE_URL = f"sqlite:///{DATABASE_PATH.as_posix()}"

engine = create_database_engine(DATABASE_URL)

SessionLocal = sessionmaker(
	autocommit=False,
	autoflush=False,
	bind=engine,
)
