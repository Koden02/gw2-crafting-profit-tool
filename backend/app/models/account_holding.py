from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.account_profile import LEGACY_ACCOUNT_ID


class AccountHolding(Base):
	__tablename__ = "account_holdings"

	account_id: Mapped[str] = mapped_column(String, primary_key=True, default=LEGACY_ACCOUNT_ID)
	item_id: Mapped[int] = mapped_column(Integer, primary_key=True)
	material_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
	bank_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
	shared_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
	character_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
	total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
	usable_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
	last_updated: Mapped[datetime] = mapped_column(DateTime, nullable=False)
