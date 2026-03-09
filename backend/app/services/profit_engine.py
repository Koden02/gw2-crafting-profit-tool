from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from app.models.commerce_price import CommercePrice
from app.models.item import Item
from app.models.recipe import Recipe


class ProfitEngine:
	def __init__(self, db: Session) -> None:
		self.db = db
		self._craft_cost_cache: dict[int, float | None] = {}

	def get_item(self, item_id: int) -> Item | None:
		return self.db.get(Item, item_id)

	def get_item_name(self, item_id: int) -> str:
		item = self.get_item(item_id)
		return item.name if item else f"Unknown Item {item_id}"

	def get_recipe_for_item(self, item_id: int) -> Recipe | None:
		return self.db.query(Recipe).filter(Recipe.output_item_id == item_id).first()

	def get_price_row(self, item_id: int) -> CommercePrice | None:
		return self.db.get(CommercePrice, item_id)

	def get_buy_price(self, item_id: int) -> int | None:
		price = self.get_price_row(item_id)
		if price is None:
			return None
		return price.buy_price

	def get_sell_price(self, item_id: int) -> int | None:
		price = self.get_price_row(item_id)
		if price is None:
			return None
		return price.sell_price

	def parse_disciplines(self, raw_disciplines: str | None) -> list[str]:
		if not raw_disciplines:
			return []

		try:
			parsed = json.loads(raw_disciplines)
			if isinstance(parsed, list):
				return [str(value) for value in parsed]
		except json.JSONDecodeError:
			pass

		return []

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

	def build_ingredient_breakdown(self, item_id: int) -> list[dict[str, Any]]:
		recipe = self.get_recipe_for_item(item_id)
		if recipe is None:
			return []

		breakdown: list[dict[str, Any]] = []

		for ingredient in recipe.ingredients:
			buy_price = self.get_buy_price(ingredient.item_id)
			craft_price = self.calculate_craft_cost(ingredient.item_id)

			options = []
			if buy_price is not None:
				options.append(("buy", float(buy_price)))
			if craft_price is not None:
				options.append(("craft", float(craft_price)))

			if not options:
				chosen_source = "unavailable"
				chosen_unit_cost = None
				total_cost = None
			else:
				chosen_source, chosen_unit_cost = min(options, key=lambda option: option[1])
				total_cost = chosen_unit_cost * ingredient.count

			breakdown.append(
				{
					"item_id": ingredient.item_id,
					"name": self.get_item_name(ingredient.item_id),
					"count": ingredient.count,
					"buy_price": buy_price,
					"craft_price": round(craft_price, 2) if craft_price is not None else None,
					"chosen_source": chosen_source,
					"chosen_unit_cost": round(chosen_unit_cost, 2) if chosen_unit_cost is not None else None,
					"total_cost": round(total_cost, 2) if total_cost is not None else None,
				}
			)

		return breakdown

	def calculate_profit(self, item_id: int) -> dict[str, Any] | None:
		craft_cost = self.calculate_craft_cost(item_id)
		price_row = self.get_price_row(item_id)

		if craft_cost is None or price_row is None or price_row.sell_price is None:
			return None

		sell_price = price_row.sell_price
		buy_price = price_row.buy_price
		buy_quantity = price_row.buy_quantity or 0
		sell_quantity = price_row.sell_quantity or 0

		net_sale = sell_price * 0.85
		profit = net_sale - craft_cost
		roi = profit / craft_cost if craft_cost > 0 else None

		spread = None
		spread_ratio = None
		if buy_price is not None:
			spread = sell_price - buy_price
			if buy_price > 0:
				spread_ratio = sell_price / buy_price

		low_liquidity = buy_quantity < 5 or sell_quantity < 5
		suspicious_spread = spread_ratio is not None and spread_ratio > 10

		recipe = self.get_recipe_for_item(item_id)
		disciplines: list[str] = []
		output_item_count = 1

		if recipe is not None:
			disciplines = self.parse_disciplines(recipe.disciplines)
			output_item_count = recipe.output_item_count

		return {
			"item_id": item_id,
			"name": self.get_item_name(item_id),
			"disciplines": disciplines,
			"output_item_count": output_item_count,
			"craft_cost": round(craft_cost, 2),
			"buy_price": buy_price,
			"buy_quantity": buy_quantity,
			"sell_price": sell_price,
			"sell_quantity": sell_quantity,
			"net_sale": round(net_sale, 2),
			"profit": round(profit, 2),
			"roi": round(roi, 4) if roi is not None else None,
			"spread": spread,
			"spread_ratio": round(spread_ratio, 4) if spread_ratio is not None else None,
			"low_liquidity": low_liquidity,
			"suspicious_spread": suspicious_spread,
			"ingredients": self.build_ingredient_breakdown(item_id),
		}

	def calculate_profit_table(
		self,
		limit: int = 100,
		min_profit: float = 0.0,
		min_buy_quantity: int = 0,
		min_sell_quantity: int = 0,
		exclude_low_liquidity: bool = False,
		exclude_suspicious_spread: bool = False,
		discipline: str | None = None,
	) -> list[dict[str, Any]]:
		results: list[dict[str, Any]] = []

		recipes = self.db.query(Recipe).all()

		for recipe in recipes:
			result = self.calculate_profit(recipe.output_item_id)

			if result is None:
				continue

			if result["profit"] < min_profit:
				continue

			if result["buy_quantity"] < min_buy_quantity:
				continue

			if result["sell_quantity"] < min_sell_quantity:
				continue

			if exclude_low_liquidity and result["low_liquidity"]:
				continue

			if exclude_suspicious_spread and result["suspicious_spread"]:
				continue

			if discipline:
				disciplines = [value.lower() for value in result["disciplines"]]
				if discipline.lower() not in disciplines:
					continue

			results.append(result)

		results.sort(key=lambda row: row["profit"], reverse=True)

		return results[:limit]