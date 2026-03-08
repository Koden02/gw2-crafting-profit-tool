from sqlalchemy import ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class RecipeIngredient(Base):
	__tablename__ = "recipe_ingredients"

	recipe_id: Mapped[int] = mapped_column(
		ForeignKey("recipes.id"),
		primary_key=True,
	)
	item_id: Mapped[int] = mapped_column(
		ForeignKey("items.id"),
		primary_key=True,
	)
	count: Mapped[int] = mapped_column(Integer, nullable=False)

	recipe = relationship("Recipe", back_populates="ingredients")