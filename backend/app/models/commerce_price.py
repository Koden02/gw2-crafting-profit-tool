from datetime import datetime

from sqlalchemy import DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CommercePrice(Base):
	__tablename__ = "commerce_prices"

	item_id: Mapped[int] = mapped_column(Integer, primary_key=True)
	buy_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
	buy_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
	sell_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
	sell_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
	last_updated: Mapped[datetime] = mapped_column(DateTime, nullable=False)