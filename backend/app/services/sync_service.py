from __future__ import annotations

import json
from typing import Any
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.item import Item
from app.models.recipe import Recipe
from app.models.recipe_ingredient import RecipeIngredient
from app.models.commerce_price import CommercePrice
from app.services.batching import chunk_list
from app.services.gw2_client import GW2Client


class SyncService:
	def __init__(self, db: Session) -> None:
		self.db = db
		self.client = GW2Client()

	def sync_items(self, batch_size: int = 200) -> int:
		item_ids = self.client.fetch_all_item_ids()
		batches = chunk_list(item_ids, batch_size)

		total_upserted = 0

		for batch in batches:
			items = self.client.fetch_items_by_ids(batch)

			for item_data in items:
				item = self.db.get(Item, item_data["id"])

				if item is None:
					item = Item(id=item_data["id"])
					self.db.add(item)

				item.name = item_data.get("name", "")
				item.type = item_data.get("type")
				item.rarity = item_data.get("rarity")
				item.level = item_data.get("level")
				item.vendor_value = item_data.get("vendor_value")
				item.flags = json.dumps(item_data.get("flags", []))

				total_upserted += 1

			self.db.commit()

		return total_upserted

	def sync_recipes(self, batch_size: int = 200) -> int:
		recipe_ids = self.client.fetch_all_recipe_ids()
		batches = chunk_list(recipe_ids, batch_size)

		total_upserted = 0

		for batch in batches:
			recipes = self.client.fetch_recipes_by_ids(batch)

			for recipe_data in recipes:
				recipe = self.db.get(Recipe, recipe_data["id"])

				if recipe is None:
					recipe = Recipe(id=recipe_data["id"])
					self.db.add(recipe)

				recipe.output_item_id = recipe_data["output_item_id"]
				recipe.output_item_count = recipe_data.get("output_item_count", 1)
				recipe.disciplines = json.dumps(recipe_data.get("disciplines", []))

				self.db.query(RecipeIngredient).filter(
					RecipeIngredient.recipe_id == recipe.id
				).delete()

				for ingredient_data in recipe_data.get("ingredients", []):
					ingredient = RecipeIngredient(
						recipe_id=recipe.id,
						item_id=ingredient_data["item_id"],
						count=ingredient_data["count"],
					)
					self.db.add(ingredient)

				total_upserted += 1

			self.db.commit()

		return total_upserted

	def sync_prices(self, batch_size: int = 200) -> int:
		item_ids = self.client.fetch_all_commerce_price_ids()
		batches = chunk_list(item_ids, batch_size)

		total_upserted = 0
		now = datetime.now(timezone.utc)

		for batch in batches:
			prices = self.client.fetch_commerce_prices_by_ids(batch)

			for price_data in prices:
				item_id = price_data["id"]

				price = self.db.get(CommercePrice, item_id)

				if price is None:
					price = CommercePrice(item_id=item_id)
					self.db.add(price)

				buys = price_data.get("buys", {})
				sells = price_data.get("sells", {})

				price.buy_price = buys.get("unit_price")
				price.buy_quantity = buys.get("quantity")
				price.sell_price = sells.get("unit_price")
				price.sell_quantity = sells.get("quantity")
				price.last_updated = now

				total_upserted += 1

			self.db.commit()

		return total_upserted