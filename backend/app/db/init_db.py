from app.db.session import engine
from app.db.migrations import migrate
import app.models  # noqa: F401


def init_db() -> None:
	migrate(engine)
