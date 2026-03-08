from __future__ import annotations

from typing import Any

import httpx


class GW2Client:
	def __init__(self, base_url: str = "https://api.guildwars2.com") -> None:
		self.base_url = base_url
		self.timeout = 30.0

	def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
		url = f"{self.base_url}{path}"

		with httpx.Client(timeout=self.timeout) as client:
			response = client.get(url, params=params)
			response.raise_for_status()
			return response.json()

	def fetch_all_item_ids(self) -> list[int]:
		return self._get("/v2/items")

	def fetch_items_by_ids(self, item_ids: list[int]) -> list[dict[str, Any]]:
		if not item_ids:
			return []

		ids_param = ",".join(str(item_id) for item_id in item_ids)
		return self._get("/v2/items", params={"ids": ids_param})

	def fetch_all_recipe_ids(self) -> list[int]:
		return self._get("/v2/recipes")

	def fetch_recipes_by_ids(self, recipe_ids: list[int]) -> list[dict[str, Any]]:
		if not recipe_ids:
			return []

		ids_param = ",".join(str(recipe_id) for recipe_id in recipe_ids)
		return self._get("/v2/recipes", params={"ids": ids_param})

	def fetch_commerce_prices_by_ids(self, item_ids: list[int]) -> list[dict[str, Any]]:
		if not item_ids:
			return []

		ids_param = ",".join(str(item_id) for item_id in item_ids)
		return self._get("/v2/commerce/prices", params={"ids": ids_param})

	def fetch_all_commerce_price_ids(self) -> list[int]:
		return self._get("/v2/commerce/prices")