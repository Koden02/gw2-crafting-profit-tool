from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AppSetting(Base):
	__tablename__ = "app_settings"

	key: Mapped[str] = mapped_column(String, primary_key=True)
	value: Mapped[str] = mapped_column(Text, nullable=False)
	updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
