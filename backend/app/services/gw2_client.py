from __future__ import annotations

from typing import Any

import httpx


class GW2Client:
	def __init__(self, base_url: str = "https://api.guildwars2.com") -> None:
		self.base_url = base_url
		self.timeout = 30.0

	def _get(
		self,
		path: str,
		params: dict[str, Any] | None = None,
		headers: dict[str, str] | None = None,
	) -> Any:
		url = f"{self.base_url}{path}"

		with httpx.Client(timeout=self.timeout) as client:
			response = client.get(url, params=params, headers=headers)
			response.raise_for_status()
			return response.json()

	def _auth_headers(self, api_key: str) -> dict[str, str]:
		return {"Authorization": f"Bearer {api_key}"}

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

	def fetch_commerce_listing(self, item_id: int) -> dict[str, Any]:
		return self._get(f"/v2/commerce/listings/{item_id}")

	def fetch_account_materials(self, api_key: str) -> list[dict[str, Any]]:
		return self._get("/v2/account/materials", headers=self._auth_headers(api_key))

	def fetch_account_bank(self, api_key: str) -> list[dict[str, Any] | None]:
		return self._get("/v2/account/bank", headers=self._auth_headers(api_key))
