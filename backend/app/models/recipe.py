from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Recipe(Base):
	__tablename__ = "recipes"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	output_item_id: Mapped[int] = mapped_column(
		ForeignKey("items.id"),
		nullable=False,
		index=True,
	)
	output_item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
	disciplines: Mapped[str | None] = mapped_column(Text, nullable=True)

	ingredients = relationship(
		"RecipeIngredient",
		back_populates="recipe",
		cascade="all, delete-orphan",
	)