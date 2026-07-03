from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
import json
import math
from typing import Any

from sqlalchemy.orm import Session

from app.models.account_holding import AccountHolding
from app.models.commerce_price import CommercePrice
from app.models.item import Item
from app.models.price_history import CommercePriceRollup, CommercePriceSnapshot
from app.models.recipe import Recipe

MARKET_FLOW_WINDOW_DAYS = 7
MARKET_FLOW_MIN_OBSERVATIONS = 3
MARKET_FLOW_MIN_WINDOW_HOURS = 1
MARKET_FLOW_STALE_AFTER_HOURS = 48


class ProfitEngine:
	def __init__(self, db: Session) -> None:
		self.db = db
		self._craft_cost_cache: dict[tuple[int, str], float | None] = {}

		self.items_by_id = {
			item.id: item
			for item in self.db.query(Item).all()
		}

		self.prices_by_item_id = {
			price.item_id: price
			for price in self.db.query(CommercePrice).all()
		}

		self.holdings_by_item_id = {
			holding.item_id: holding
			for holding in self.db.query(AccountHolding).all()
		}

		self.recipes_by_output_item_id = {
			recipe.output_item_id: recipe
			for recipe in self.db.query(Recipe).all()
		}

		snapshot_history_item_ids = {
			item_id
			for item_id, in self.db.query(CommercePriceSnapshot.item_id).distinct().all()
		}
		rollup_history_item_ids = {
			item_id
			for item_id, in self.db.query(CommercePriceRollup.item_id).distinct().all()
		}
		self.price_history_item_ids = snapshot_history_item_ids | rollup_history_item_ids
		self.market_flow_by_item_id = self.build_market_flow_by_item_id()

	def get_item(self, item_id: int) -> Item | None:
		return self.items_by_id.get(item_id)

	@staticmethod
	def listing_fee(price: int) -> int:
		return max(1, math.floor(price * 0.05))

	@staticmethod
	def exchange_fee(price: int) -> int:
		return max(1, math.floor(price * 0.10))

	@staticmethod
	def trading_post_net(price: int) -> int:
		return price - ProfitEngine.listing_fee(price) - ProfitEngine.exchange_fee(price)

	@staticmethod
	def break_even_sale_price(craft_cost: float) -> int:
		price = max(1, math.ceil(craft_cost))

		while ProfitEngine.trading_post_net(price) < craft_cost:
			price += 1

		return price

	def get_item_name(self, item_id: int) -> str:
		item = self.get_item(item_id)
		return item.name if item else f"Unknown Item {item_id}"

	def get_recipe_for_item(self, item_id: int) -> Recipe | None:
		return self.recipes_by_output_item_id.get(item_id)

	def get_price_row(self, item_id: int) -> CommercePrice | None:
		return self.prices_by_item_id.get(item_id)

	def get_owned_count(self, item_id: int) -> int:
		holding = self.holdings_by_item_id.get(item_id)
		return holding.total_count if holding is not None else 0

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

	def calculate_craft_cost(
		self,
		item_id: int,
		material_pricing: str = "buy"
	) -> float | None:
		cache_key = (item_id, material_pricing)

		if cache_key in self._craft_cost_cache:
			return self._craft_cost_cache[cache_key]

		recipe = self.get_recipe_for_item(item_id)
		if recipe is None:
			market_price = self.get_buy_price(item_id) if material_pricing == "buy" else self.get_sell_price(item_id)
			self._craft_cost_cache[cache_key] = float(market_price) if market_price is not None else None
			return self._craft_cost_cache[cache_key]

		total_cost = 0.0

		for ingredient in recipe.ingredients:
			if material_pricing == "buy":
				market_price = self.get_buy_price(ingredient.item_id)
			else:
				market_price = self.get_sell_price(ingredient.item_id)

			craft_price = self.calculate_craft_cost(ingredient.item_id, material_pricing)

			options = [price for price in [market_price, craft_price] if price is not None]
			if not options:
				self._craft_cost_cache[cache_key] = None
				return None

			ingredient_unit_cost = min(options)
			total_cost += ingredient_unit_cost * ingredient.count

		if recipe.output_item_count > 0:
			total_cost = total_cost / recipe.output_item_count

		self._craft_cost_cache[cache_key] = total_cost
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

			owned_count = self.get_owned_count(ingredient.item_id)

			breakdown.append(
				{
					"item_id": ingredient.item_id,
					"name": self.get_item_name(ingredient.item_id),
					"count": ingredient.count,
					"owned_count": owned_count,
					"missing_count": max(ingredient.count - owned_count, 0),
					"buy_price": buy_price,
					"craft_price": round(craft_price, 2) if craft_price is not None else None,
					"chosen_source": chosen_source,
					"chosen_unit_cost": round(chosen_unit_cost, 2) if chosen_unit_cost is not None else None,
					"total_cost": round(total_cost, 2) if total_cost is not None else None,
				}
			)

		return breakdown

	def calculate_profit(
		self,
		item_id: int,
		material_pricing: str = "buy",
		output_pricing: str = "sell",
	) -> dict[str, Any] | None:
		craft_cost = self.calculate_craft_cost(item_id, material_pricing)
		price_row = self.get_price_row(item_id)

		if craft_cost is None or price_row is None or price_row.sell_price is None:
			return None

		if output_pricing == "sell":
			sell_price = price_row.sell_price
		else:
			sell_price = price_row.buy_price
		buy_price = price_row.buy_price
		buy_quantity = price_row.buy_quantity or 0
		sell_quantity = price_row.sell_quantity or 0

		net_sale = self.trading_post_net(sell_price)
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
		ingredient_sale_total = 0.0

		if recipe:
			for ingredient in recipe.ingredients:
				ingredient_sell_price = self.get_sell_price(ingredient.item_id)

				if ingredient_sell_price is None:
					continue

				ingredient_net = self.trading_post_net(ingredient_sell_price)
				ingredient_sale_total += ingredient_net * ingredient.count

		if recipe is not None:
			disciplines = self.parse_disciplines(recipe.disciplines)
			output_item_count = recipe.output_item_count

		crafted_value_total = net_sale * output_item_count
		value_add = crafted_value_total - ingredient_sale_total
		if value_add > 0:
			recommendation = "Craft"
		elif value_add < 0:
			recommendation = "Sell Ingredients"
		else:
			recommendation = "Break Even"  
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
			"has_price_history": item_id in self.price_history_item_ids,
			**self.market_flow_for_item(item_id),
			"ingredients": self.build_ingredient_breakdown(item_id),
			"ingredient_sale_value": round(ingredient_sale_total, 2),
			"value_add": round(value_add, 2),
			"recommendation": recommendation,
   			"crafted_item_value": round(crafted_value_total, 2),
		}

	def calculate_profit_table(
		self,
		limit: int = 100,
		min_profit: float = 0.0,
		min_buy_quantity: int = 0,
		min_sell_quantity: int = 0,
		exclude_low_liquidity: bool = False,
		exclude_suspicious_spread: bool = False,
		exclude_stalled_markets: bool = False,
		discipline: str | None = None,
		material_pricing: str = "buy",
		output_pricing: str = "sell",
	) -> list[dict[str, Any]]:
		results: list[dict[str, Any]] = []

		recipes = self.db.query(Recipe).all()

		for recipe in recipes:
			result = self.calculate_profit(
				recipe.output_item_id,
				material_pricing=material_pricing,
				output_pricing=output_pricing,
			)

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

			if exclude_stalled_markets and result["market_flow_status"] == "stalled":
				continue

			if discipline:
				disciplines = [value.lower() for value in result["disciplines"]]
				if discipline.lower() not in disciplines:
					continue

			results.append(result)
		results.sort(key=lambda row: row["profit"], reverse=True)

		return results[:limit]

	def build_market_flow_by_item_id(self) -> dict[int, dict[str, Any]]:
		output_item_ids = list(self.recipes_by_output_item_id.keys())

		if not output_item_ids:
			return {}

		now = datetime.now(timezone.utc)
		start_at = now - timedelta(days=MARKET_FLOW_WINDOW_DAYS)
		rows = (
			self.db.query(
				CommercePriceSnapshot.item_id,
				CommercePriceSnapshot.observed_at,
				CommercePriceSnapshot.buy_price,
				CommercePriceSnapshot.buy_quantity,
				CommercePriceSnapshot.sell_price,
				CommercePriceSnapshot.sell_quantity,
			)
			.filter(
				CommercePriceSnapshot.item_id.in_(output_item_ids),
				CommercePriceSnapshot.observed_at >= start_at,
			)
			.order_by(CommercePriceSnapshot.item_id.asc(), CommercePriceSnapshot.observed_at.asc())
			.all()
		)
		points_by_item_id: dict[int, list[Any]] = defaultdict(list)

		for row in rows:
			points_by_item_id[row.item_id].append(row)

		return {
			item_id: self.calculate_market_flow(points, now=now)
			for item_id, points in points_by_item_id.items()
		}

	def market_flow_for_item(self, item_id: int) -> dict[str, Any]:
		return self.market_flow_by_item_id.get(item_id, self.default_market_flow())

	def default_market_flow(self) -> dict[str, Any]:
		return {
			"market_flow_status": "unknown",
			"market_flow_score": None,
			"market_flow_observations": 0,
			"market_flow_window_hours": 0,
			"market_flow_quantity_change_count": 0,
			"market_flow_price_change_count": 0,
			"market_flow_summary": "No local price history samples are available yet.",
		}

	def calculate_market_flow(self, points: list[Any], now: datetime) -> dict[str, Any]:
		observations = len(points)

		if observations == 0:
			return self.default_market_flow()

		first_observed_at = self.normalize_datetime(points[0].observed_at)
		latest_observed_at = self.normalize_datetime(points[-1].observed_at)
		window_hours = max(0.0, (latest_observed_at - first_observed_at).total_seconds() / 3600)
		latest_age_hours = max(0.0, (now - latest_observed_at).total_seconds() / 3600)

		if observations < MARKET_FLOW_MIN_OBSERVATIONS:
			return {
				**self.default_market_flow(),
				"market_flow_observations": observations,
				"market_flow_window_hours": round(window_hours, 2),
				"market_flow_summary": "Not enough local history samples to estimate market flow.",
			}

		if window_hours < MARKET_FLOW_MIN_WINDOW_HOURS:
			return {
				**self.default_market_flow(),
				"market_flow_observations": observations,
				"market_flow_window_hours": round(window_hours, 2),
				"market_flow_summary": "Local history exists, but the sampled window is too short to estimate flow.",
			}

		if latest_age_hours > MARKET_FLOW_STALE_AFTER_HOURS:
			return {
				**self.default_market_flow(),
				"market_flow_observations": observations,
				"market_flow_window_hours": round(window_hours, 2),
				"market_flow_summary": "Latest local history sample is stale.",
			}

		quantity_change_count = 0
		price_change_count = 0
		total_quantity_delta = 0

		for previous, current in zip(points, points[1:]):
			quantity_changed = False
			price_changed = False

			for previous_value, current_value in [
				(previous.buy_quantity, current.buy_quantity),
				(previous.sell_quantity, current.sell_quantity),
			]:
				if previous_value is None or current_value is None:
					continue

				if previous_value != current_value:
					quantity_changed = True
					total_quantity_delta += abs(current_value - previous_value)

			for previous_value, current_value in [
				(previous.buy_price, current.buy_price),
				(previous.sell_price, current.sell_price),
			]:
				if previous_value is None or current_value is None:
					continue

				if previous_value != current_value:
					price_changed = True

			if quantity_changed:
				quantity_change_count += 1

			if price_changed:
				price_change_count += 1

		transitions = max(1, observations - 1)
		quantity_change_ratio = quantity_change_count / transitions
		price_change_ratio = price_change_count / transitions
		latest_total_quantity = max(
			1,
			(points[-1].buy_quantity or 0) + (points[-1].sell_quantity or 0),
		)
		quantity_delta_signal = min(total_quantity_delta / latest_total_quantity, 1)
		score = round(
			min(
				100,
				(quantity_change_ratio * 70)
				+ (price_change_ratio * 20)
				+ (quantity_delta_signal * 10),
			)
		)

		if quantity_change_count == 0 and price_change_count == 0:
			status = "stalled"
			score = 0
			summary = f"No quantity or price movement across {observations} local samples."
		elif score >= 45 or quantity_change_ratio >= 0.35:
			status = "moving"
			summary = f"Recent quantity movement across {observations} local samples."
		else:
			status = "slow"
			summary = f"Limited market movement across {observations} local samples."

		return {
			"market_flow_status": status,
			"market_flow_score": score,
			"market_flow_observations": observations,
			"market_flow_window_hours": round(window_hours, 2),
			"market_flow_quantity_change_count": quantity_change_count,
			"market_flow_price_change_count": price_change_count,
			"market_flow_summary": summary,
		}

	def normalize_datetime(self, value: datetime) -> datetime:
		if value.tzinfo is None:
			return value.replace(tzinfo=timezone.utc)

		return value.astimezone(timezone.utc)

	def calculate_listing_depth(
		self,
		item_id: int,
		listing_data: dict[str, Any],
		material_pricing: str = "buy",
	) -> dict[str, Any] | None:
		craft_cost = self.calculate_craft_cost(item_id, material_pricing)

		if craft_cost is None:
			return None

		break_even_price = self.break_even_sale_price(craft_cost)
		buy_levels = self.normalize_listing_levels(listing_data.get("buys", []), reverse=True)
		sell_levels = self.normalize_listing_levels(listing_data.get("sells", []), reverse=False)

		profitable_buy_levels: list[dict[str, Any]] = []
		instant_sell_limit_quantity = 0
		instant_sell_depth_profit = 0.0
		last_profitable_buy_order_price = None

		for level in buy_levels:
			net_sale = self.trading_post_net(level["unit_price"])
			profit_per_item = net_sale - craft_cost

			if profit_per_item <= 0:
				break

			last_profitable_buy_order_price = level["unit_price"]
			instant_sell_limit_quantity += level["quantity"]
			instant_sell_depth_profit += profit_per_item * level["quantity"]
			profitable_buy_levels.append(
				{
					**level,
					"net_sale": net_sale,
					"profit_per_item": round(profit_per_item, 2),
				}
			)

		profitable_sell_levels = []
		existing_competing_sell_quantity = 0

		for level in sell_levels:
			net_sale = self.trading_post_net(level["unit_price"])
			profit_per_item = net_sale - craft_cost

			if profit_per_item <= 0:
				continue

			existing_competing_sell_quantity += level["quantity"]
			profitable_sell_levels.append(
				{
					**level,
					"net_sale": net_sale,
					"profit_per_item": round(profit_per_item, 2),
				}
			)

		lowest_sell_price = sell_levels[0]["unit_price"] if sell_levels else None
		estimated_market_pressure = self.estimate_market_pressure(
			craft_cost=craft_cost,
			lowest_sell_price=lowest_sell_price,
			existing_competing_sell_quantity=existing_competing_sell_quantity,
			instant_sell_limit_quantity=instant_sell_limit_quantity,
		)

		return {
			"item_id": item_id,
			"name": self.get_item_name(item_id),
			"craft_cost": round(craft_cost, 2),
			"break_even_sale_price": break_even_price,
			"last_profitable_buy_order_price": last_profitable_buy_order_price,
			"instant_sell_limit_quantity": instant_sell_limit_quantity,
			"instant_sell_depth_profit": round(instant_sell_depth_profit, 2),
			"profitable_buy_order_levels": profitable_buy_levels[:20],
			"profitable_buy_order_level_count": len(profitable_buy_levels),
			"profitable_listing_price_floor": break_even_price,
			"existing_competing_sell_quantity": existing_competing_sell_quantity,
			"competing_sell_levels": profitable_sell_levels[:20],
			"competing_sell_level_count": len(profitable_sell_levels),
			"estimated_market_pressure": estimated_market_pressure,
		}

	def normalize_listing_levels(
		self,
		raw_levels: list[dict[str, Any]],
		reverse: bool,
	) -> list[dict[str, int]]:
		levels = []

		for level in raw_levels:
			unit_price = level.get("unit_price")
			quantity = level.get("quantity")
			listings = level.get("listings", 0)

			if not isinstance(unit_price, int) or not isinstance(quantity, int):
				continue

			levels.append(
				{
					"unit_price": unit_price,
					"quantity": quantity,
					"listings": listings if isinstance(listings, int) else 0,
				}
			)

		return sorted(levels, key=lambda level: level["unit_price"], reverse=reverse)

	def estimate_market_pressure(
		self,
		craft_cost: float,
		lowest_sell_price: int | None,
		existing_competing_sell_quantity: int,
		instant_sell_limit_quantity: int,
	) -> str:
		if lowest_sell_price is None:
			return "dead market"

		if self.trading_post_net(lowest_sell_price) <= craft_cost:
			return "dead market"

		if existing_competing_sell_quantity < 50 or instant_sell_limit_quantity < 10:
			return "thin market"

		return "healthy market"
