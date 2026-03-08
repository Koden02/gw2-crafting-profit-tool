from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Item(Base):
	__tablename__ = "items"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	name: Mapped[str] = mapped_column(String, nullable=False, index=True)
	type: Mapped[str | None] = mapped_column(String, nullable=True)
	rarity: Mapped[str | None] = mapped_column(String, nullable=True)
	level: Mapped[int | None] = mapped_column(Integer, nullable=True)
	vendor_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
	flags: Mapped[str | None] = mapped_column(Text, nullable=True)