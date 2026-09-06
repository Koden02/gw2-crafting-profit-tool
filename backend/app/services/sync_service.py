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
from app.services.price_history_service import PriceHistoryService
from app.services.price_sync_lock import price_sync_lock


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
				recipe.min_rating = recipe_data.get("min_rating")
				recipe.flags = json.dumps(recipe_data.get("flags", []))
				recipe.recipe_type = recipe_data.get("type")
				recipe.ingredients_complete = True
				recipe.unsupported_reason = None
				if recipe_data.get("guild_ingredients") or recipe_data.get("output_upgrade_id"):
					recipe.unsupported_reason = "Guild ingredients or outputs are not supported."

				self.db.query(RecipeIngredient).filter(
					RecipeIngredient.recipe_id == recipe.id
				).delete()

				for ingredient_data in recipe_data.get("ingredients", []):
					if ingredient_data.get("type", "Item") != "Item":
						recipe.unsupported_reason = "Non-item ingredients require acquisition and valuation support."
						continue
					ingredient_id = ingredient_data.get("item_id", ingredient_data.get("id"))
					if type(ingredient_id) is not int or ingredient_id <= 0 or type(ingredient_data.get("count")) is not int or ingredient_data["count"] <= 0:
						recipe.ingredients_complete = False
						continue
					ingredient = RecipeIngredient(
						recipe_id=recipe.id,
						item_id=ingredient_id,
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

	def sync_prices_with_history(self, batch_size: int = 200, source: str = "manual") -> dict[str, object]:
		with price_sync_lock.acquire(source):
			total_upserted = self.sync_prices(batch_size=batch_size)
			history_service = PriceHistoryService(self.db)
			snapshot_result = history_service.record_snapshot_if_due()
			prune_result = history_service.prune_history()

			return {
				"status": "ok",
				"prices_upserted": total_upserted,
				"snapshot_status": snapshot_result["status"],
				"snapshot_reason": snapshot_result["reason"],
				"snapshots_recorded": snapshot_result["snapshots_recorded"],
				"snapshot_observed_at": snapshot_result["observed_at"],
				"history_pruned": prune_result,
			}
