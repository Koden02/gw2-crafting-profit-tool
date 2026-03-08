from app.services.gw2_client import GW2Client
from app.services.batching import chunk_list


def main() -> None:
	client = GW2Client()

	item_ids = client.fetch_all_item_ids()
	print(f"Fetched {len(item_ids)} item IDs")

	first_item_batch = chunk_list(item_ids, 10)[0]
	items = client.fetch_items_by_ids(first_item_batch)
	print(f"Fetched {len(items)} item records")
	print("First item:", items[0]["name"], items[0]["id"])

	recipe_ids = client.fetch_all_recipe_ids()
	print(f"Fetched {len(recipe_ids)} recipe IDs")

	first_recipe_batch = chunk_list(recipe_ids, 10)[0]
	recipes = client.fetch_recipes_by_ids(first_recipe_batch)
	print(f"Fetched {len(recipes)} recipe records")
	print("First recipe output item:", recipes[0].get("output_item_id"))

	price_ids = [item["id"] for item in items]
	prices = client.fetch_commerce_prices_by_ids(price_ids)
	print(f"Fetched {len(prices)} commerce price records")

	if prices:
		print("First price row:", prices[0])


if __name__ == "__main__":
	main()