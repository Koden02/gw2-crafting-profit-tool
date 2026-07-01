from datetime import datetime

from sqlalchemy import DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AccountHolding(Base):
	__tablename__ = "account_holdings"

	item_id: Mapped[int] = mapped_column(Integer, primary_key=True)
	material_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
	bank_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
	total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
	last_updated: Mapped[datetime] = mapped_column(DateTime, nullable=False)
