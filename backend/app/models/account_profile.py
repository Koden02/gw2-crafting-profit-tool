from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

LEGACY_ACCOUNT_ID = "legacy-owner-unknown"


class AccountProfile(Base):
    __tablename__ = "account_profiles"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    snapshot_id: Mapped[str | None] = mapped_column(String)
    reservation_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    last_updated: Mapped[datetime | None] = mapped_column(DateTime)
    source: Mapped[str] = mapped_column(String, default="api", nullable=False)
    coverage: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class AccountStack(Base):
    """Physical observations; aggregates must never be added to these quantities."""

    __tablename__ = "account_stacks"

    account_id: Mapped[str] = mapped_column(String, primary_key=True)
    source: Mapped[str] = mapped_column(String, primary_key=True)
    position: Mapped[str] = mapped_column(String, primary_key=True)
    item_id: Mapped[int] = mapped_column(Integer, nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False)
    binding: Mapped[str | None] = mapped_column(String)
    bound_to: Mapped[str | None] = mapped_column(String)
