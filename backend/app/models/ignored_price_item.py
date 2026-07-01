from datetime import datetime

from sqlalchemy import DateTime, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class IgnoredPriceItem(Base):
	__tablename__ = "ignored_price_items"

	item_id: Mapped[int] = mapped_column(Integer, primary_key=True)
	reason: Mapped[str | None] = mapped_column(Text, nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
