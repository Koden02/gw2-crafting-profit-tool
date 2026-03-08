from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.models.commerce_price import CommercePrice
from app.models.item import Item
from app.models.recipe import Recipe


@dataclass
class IngredientBreakdown:
	item_id: int
	name: str
	count: int
	buy_price: int | None
	craft_price: float | None
	chosen_price: float
	source: str


class ProfitEngine:
	def __init__(self, db: Session) -> None:
		self.db = db
		self._craft_cost_cache: dict[int, float | None] = {}

	def get_item_name(self, item_id: int) -> str:
		item = self.db.get(Item, item_id)
		return item.name if item else f"Unknown Item {item_id}"

	def get_recipe_for_item(self, item_id: int) -> Recipe | None:
		return self.db.query(Recipe).filter(Recipe.output_item_id == item_id).first()

	def get_buy_price(self, item_id: int) -> int | None:
		price = self.db.get(CommercePrice, item_id)
		if price is None:
			return None
		return price.buy_price

	def get_sell_price(self, item_id: int) -> int | None:
		price = self.db.get(CommercePrice, item_id)
		if price is None:
			return None
		return price.sell_price

	def calculate_craft_cost(self, item_id: int) -> float | None:
		if item_id in self._craft_cost_cache:
			return self._craft_cost_cache[item_id]

		recipe = self.get_recipe_for_item(item_id)
		if recipe is None:
			buy_price = self.get_buy_price(item_id)
			self._craft_cost_cache[item_id] = float(buy_price) if buy_price is not None else None
			return self._craft_cost_cache[item_id]

		total_cost = 0.0

		for ingredient in recipe.ingredients:
			buy_price = self.get_buy_price(ingredient.item_id)
			craft_price = self.calculate_craft_cost(ingredient.item_id)

			options = [price for price in [buy_price, craft_price] if price is not None]
			if not options:
				self._craft_cost_cache[item_id] = None
				return None

			ingredient_unit_cost = min(options)
			total_cost += ingredient_unit_cost * ingredient.count

		if recipe.output_item_count > 0:
			total_cost = total_cost / recipe.output_item_count

		self._craft_cost_cache[item_id] = total_cost
		return total_cost

	def calculate_profit(self, item_id: int) -> dict[str, Any] | None:
		craft_cost = self.calculate_craft_cost(item_id)
		sell_price = self.get_sell_price(item_id)

		if craft_cost is None or sell_price is None:
			return None

		net_sale = sell_price * 0.85
		profit = net_sale - craft_cost
		roi = profit / craft_cost if craft_cost > 0 else None

		return {
			"item_id": item_id,
			"name": self.get_item_name(item_id),
			"craft_cost": round(craft_cost, 2),
			"sell_price": sell_price,
			"net_sale": round(net_sale, 2),
			"profit": round(profit, 2),
			"roi": round(roi, 4) if roi is not None else None,
		}