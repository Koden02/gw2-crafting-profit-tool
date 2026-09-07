from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AccountTradingPost(Base):
    """Orders and deliveries are observations, never physical inventory stacks."""
    __tablename__ = "account_trading_post"

    account_id: Mapped[str] = mapped_column(String, primary_key=True)
    snapshot_id: Mapped[str] = mapped_column(String, nullable=False)
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String, nullable=False)
    error: Mapped[str | None] = mapped_column(String)
    payload: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
