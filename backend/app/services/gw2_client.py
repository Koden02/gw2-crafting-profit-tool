from __future__ import annotations

from typing import Any
from urllib.parse import quote
from time import monotonic

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
		return self._get("/v2/recipes", params={"ids": ids_param, "v": "latest"})

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

	def fetch_account(self, api_key: str) -> dict[str, Any]:
		return self._get("/v2/account", headers=self._auth_headers(api_key))

	def fetch_account_bank(self, api_key: str) -> list[dict[str, Any] | None]:
		return self._get("/v2/account/bank", headers=self._auth_headers(api_key))

	def fetch_shared_inventory(self, api_key: str) -> list[dict[str, Any] | None]:
		return self._get("/v2/account/inventory", headers=self._auth_headers(api_key))

	def fetch_character_inventory(self, api_key: str, name: str) -> dict:
		return self._get(f"/v2/characters/{quote(name, safe='')}/inventory", headers=self._auth_headers(api_key))

	def fetch_character_names(self, api_key: str) -> list[str]:
		return self._get("/v2/characters", headers=self._auth_headers(api_key))

	def fetch_character_crafting(self, api_key: str, name: str) -> dict:
		return self._get(f"/v2/characters/{quote(name, safe='')}/crafting", headers=self._auth_headers(api_key))

	def fetch_character_recipes(self, api_key: str, name: str) -> dict:
		return self._get(f"/v2/characters/{quote(name, safe='')}/recipes", headers=self._auth_headers(api_key))

	def fetch_account_recipes(self, api_key: str) -> list[int]:
		return self._get("/v2/account/recipes", headers=self._auth_headers(api_key))

	def fetch_current_orders(self, api_key: str, side: str) -> list[dict]:
		if side not in {"buys", "sells"}:
			raise ValueError("Invalid order side")
		rows, expected = [], None
		deadline = monotonic() + 60
		with httpx.Client(timeout=min(self.timeout, 10)) as client:
			for page in range(50):
				if monotonic() >= deadline:
					raise ValueError("Trading Post pagination timed out; refresh again.")
				response = client.get(f"{self.base_url}/v2/commerce/transactions/current/{side}",
					params={"page": page, "page_size": 200}, headers=self._auth_headers(api_key))
				response.raise_for_status()
				try:
					counts = (int(response.headers["X-Page-Total"]), int(response.headers["X-Result-Total"]))
					part = response.json()
					if (not isinstance(part, list) or not 0 <= counts[0] <= 50 or counts[1] < 0
							or (expected is not None and counts != expected)):
						raise ValueError()
				except (ValueError, KeyError) as exc:
					raise ValueError("Incomplete or changing Trading Post pages; refresh again.") from exc
				expected = counts
				rows.extend(part)
				if page + 1 >= counts[0]:
					if len(rows) != counts[1]:
						raise ValueError("Incomplete Trading Post orders; refresh again.")
					return rows
		raise ValueError("Trading Post page limit reached; previous orders were preserved.")

	def fetch_delivery(self, api_key: str) -> dict:
		return self._get("/v2/commerce/delivery", headers=self._auth_headers(api_key))
