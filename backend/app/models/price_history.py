from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CommercePriceSnapshot(Base):
	__tablename__ = "commerce_price_snapshots"
	__table_args__ = (
		Index("ix_commerce_price_snapshots_observed_at", "observed_at"),
	)

	item_id: Mapped[int] = mapped_column(Integer, primary_key=True)
	observed_at: Mapped[datetime] = mapped_column(DateTime, primary_key=True)
	buy_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
	buy_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
	sell_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
	sell_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)


class CommercePriceRollup(Base):
	__tablename__ = "commerce_price_rollups"
	__table_args__ = (
		Index("ix_commerce_price_rollups_bucket", "bucket_type", "bucket_start"),
	)

	item_id: Mapped[int] = mapped_column(Integer, primary_key=True)
	bucket_type: Mapped[str] = mapped_column(String, primary_key=True)
	bucket_start: Mapped[datetime] = mapped_column(DateTime, primary_key=True)
	sample_count: Mapped[int] = mapped_column(Integer, nullable=False)
	buy_price_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
	buy_price_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
	buy_price_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
	sell_price_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
	sell_price_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
	sell_price_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
	buy_quantity_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
	sell_quantity_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
