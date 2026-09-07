from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
import json
import math
from typing import Any

from sqlalchemy.orm import Session, selectinload

from app.models.account_holding import AccountHolding
from app.models.account_profile import AccountProfile, AccountStack, LEGACY_ACCOUNT_ID
from app.models.account_crafting import AccountCrafting, MaterialReservation
from app.services.crafting_eligibility import CraftingEligibility
from app.services.reservation_service import AccountDataChanged
from app.services.inventory_coverage import source_fresh
from app.services.craft_planner import CraftPlanner, Allocation
from app.models.account_trading_post import AccountTradingPost
from app.services.trading_post_service import trading_post_status
from app.models.commerce_price import CommercePrice
from app.models.item import Item
from app.models.price_history import CommercePriceRollup, CommercePriceSnapshot
from app.models.recipe import Recipe
from app.services.batching import chunk_list

MARKET_FLOW_WINDOW_DAYS = 7
MARKET_FLOW_MIN_OBSERVATIONS = 3
MARKET_FLOW_MIN_WINDOW_HOURS = 1
MARKET_FLOW_STALE_AFTER_HOURS = 48


class ProfitEngine:
	def __init__(self, db: Session, account_id: str | None = None, include_history: bool = True,
	             *, root_item_id: int | None = None) -> None:
		self.db = db
		self.account_id = account_id
		# One SELECT keeps holdings and their snapshot identity coherent even when
		# another request replaces an account while public caches are being loaded.
		account_rows = (db.query(AccountProfile, AccountHolding)
		                .outerjoin(AccountHolding, AccountHolding.account_id == AccountProfile.id)
		                .filter(AccountProfile.id == account_id).populate_existing().all()) if account_id else []
		self.profile = account_rows[0][0] if account_rows else None
		if account_id and (not self.profile or not self.profile.verified or account_id == LEGACY_ACCOUNT_ID):
			raise ValueError("Select a verified account.")
		self.crafting_data, self.reservations = {}, {}
		self.stock_locations = []
		self.trading_post = {}
		self.trading_post_status = trading_post_status(None, self.profile)
		for attempt in range(3):
			if not self.profile:
				break
			version = (self.profile.snapshot_id, self.profile.reservation_revision)
			capabilities = db.query(AccountCrafting).filter_by(account_id=account_id).populate_existing().one_or_none()
			self.crafting_data = json.loads(capabilities.payload) if capabilities and capabilities.snapshot_id == version[0] else {}
			trading = db.query(AccountTradingPost).filter_by(account_id=account_id).populate_existing().one_or_none()
			self.trading_post_status = trading_post_status(trading, self.profile)
			self.trading_post = json.loads(trading.payload) if trading and self.trading_post_status["fresh"] else {}
			self.reservations = {r.item_id: r.quantity for r in db.query(MaterialReservation).filter_by(account_id=account_id).populate_existing().all()}
			self.stock_locations = [dict(item_id=r.item_id, source=r.source, position=r.position, quantity=r.count)
			                        for r in db.query(AccountStack).filter_by(account_id=account_id).populate_existing().all()
			                        if not r.binding and not r.bound_to]
			current = db.query(AccountProfile.snapshot_id, AccountProfile.reservation_revision).filter_by(id=account_id).one()
			if tuple(current) == version:
				break
			if attempt == 2:
				raise AccountDataChanged("Account data changed while quoting. Refresh the plan.")
			account_rows = (db.query(AccountProfile, AccountHolding)
			                .outerjoin(AccountHolding, AccountHolding.account_id == AccountProfile.id)
			                .filter(AccountProfile.id == account_id).populate_existing().all())
			self.profile = account_rows[0][0]
		self._market_plans: dict[tuple[int, str], dict] = {}

		self.load_catalog(root_item_id)

		self.holdings_by_item_id = {
			holding.item_id: holding
			for _, holding in account_rows if holding is not None and holding.item_id in self.items_by_id
		}

		self.eligibility = CraftingEligibility(self)
		if not include_history:
			self.price_history_item_ids, self.market_flow_by_item_id = set(), {}
			return

		snapshots = self.db.query(CommercePriceSnapshot.item_id)
		rollups = self.db.query(CommercePriceRollup.item_id)
		if root_item_id is not None:
			snapshots = snapshots.filter(CommercePriceSnapshot.item_id == root_item_id)
			rollups = rollups.filter(CommercePriceRollup.item_id == root_item_id)
		snapshot_history_item_ids = {item_id for item_id, in snapshots.distinct().all()}
		rollup_history_item_ids = {item_id for item_id, in rollups.distinct().all()}
		self.price_history_item_ids = snapshot_history_item_ids | rollup_history_item_ids
		self.market_flow_by_item_id = self.build_market_flow_by_item_id(
			[root_item_id] if root_item_id is not None else None)

	def load_catalog(self, root_item_id: int | None) -> None:
		"""Load every alternative along this item's ingredient graph, once per request.

		Broad searches still use the full catalog. Single-item views use indexed
		lookups; no shared account objects or stale cross-request price cache.
		"""
		self.recipes_by_output_item_id: dict[int, list[Recipe]] = defaultdict(list)
		if root_item_id is None:
			self.items_by_id = {item.id: item for item in self.db.query(Item).all()}
			self.prices_by_item_id = {price.item_id: price for price in self.db.query(CommercePrice).all()}
			for recipe in self.db.query(Recipe).options(selectinload(Recipe.ingredients)).order_by(Recipe.id).all():
				self.recipes_by_output_item_id[recipe.output_item_id].append(recipe)
			return

		visited, pending = set(), {root_item_id}
		while pending:
			frontier = sorted(pending - visited)
			visited.update(frontier)
			pending = set()
			for batch in chunk_list(frontier, 500):
				recipes = (self.db.query(Recipe).filter(Recipe.output_item_id.in_(batch))
				           .options(selectinload(Recipe.ingredients)).order_by(Recipe.id).all())
				for recipe in recipes:
					self.recipes_by_output_item_id[recipe.output_item_id].append(recipe)
					pending.update(i.item_id for i in recipe.ingredients if i.item_id not in visited)
		self.items_by_id, self.prices_by_item_id = {}, {}
		for batch in chunk_list(sorted(visited), 500):
			self.items_by_id.update((item.id, item) for item in self.db.query(Item).filter(Item.id.in_(batch)).all())
			self.prices_by_item_id.update((p.item_id, p) for p in self.db.query(CommercePrice).filter(CommercePrice.item_id.in_(batch)).all())

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
		return next(iter(self.recipes_by_output_item_id.get(item_id, [])), None)

	def get_price_row(self, item_id: int) -> CommercePrice | None:
		return self.prices_by_item_id.get(item_id)

	def get_owned_count(self, item_id: int) -> int:
		holding = self.holdings_by_item_id.get(item_id)
		item = self.get_item(item_id)
		flags = self.parse_disciplines(item.flags if item else None)
		if not item or "AccountBound" in flags or "SoulbindOnAcquire" in flags:
			return 0
		return max(0, holding.usable_count - self.reservations.get(item_id, 0)) if holding is not None else 0

	def get_buy_price(self, item_id: int) -> int | None:
		price = self.get_price_row(item_id)
		if price is None:
			return None
		return price.buy_price if price.buy_price and price.buy_price > 0 and (price.buy_quantity or 0) > 0 else None

	def get_sell_price(self, item_id: int) -> int | None:
		price = self.get_price_row(item_id)
		if price is None:
			return None
		return price.sell_price if price.sell_price and price.sell_price > 0 and (price.sell_quantity or 0) > 0 else None

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

	def price_is_stale(self, item_id: int) -> bool:
		price = self.get_price_row(item_id)
		return price is None or (datetime.now(timezone.utc) - self.normalize_datetime(price.last_updated)).total_seconds() > 3600

	def holdings_are_stale(self) -> bool:
		if not self.profile or not self.profile.last_updated:
			return True
		age = (datetime.now(timezone.utc) - self.normalize_datetime(self.profile.last_updated)).total_seconds()
		coverage = json.loads(self.profile.coverage or "{}")
		return not -300 <= age <= 3600 or any(not source_fresh(source) for source in coverage.values())

	def owned_locations(self, item_id: int, count: int) -> list[dict]:
		rows = []
		for location in sorted(self.stock_locations, key=lambda r: (r["source"], r["position"])):
			if location["item_id"] != item_id or not count:
				continue
			take = min(count, location["quantity"])
			rows.append({**location, "quantity": take})
			count -= take
		return rows

	def market_plan(self, item_id: int, material_pricing: str = "buy") -> dict:
		key = (item_id, material_pricing)
		if key not in self._market_plans:
			self._market_plans[key] = CraftPlanner(self, material_pricing).build(item_id)
		return self._market_plans[key]

	def calculate_craft_cost(self, item_id: int, material_pricing: str = "buy") -> float | None:
		if item_id not in self.recipes_by_output_item_id:
			return self.get_buy_price(item_id) if material_pricing == "buy" else self.get_sell_price(item_id)
		plan = self.market_plan(item_id, material_pricing)
		return plan["purchase_cost"] / plan["planned_quantity"] if plan["purchase_cost"] is not None else None

	def build_ingredient_breakdown(self, item_id: int, material_pricing: str = "buy",
	                               recipe_id: int | None = None) -> list[dict[str, Any]]:
		if recipe_id is None:
			recipe_id = self.market_plan(item_id, material_pricing)["recipe_id"]
		recipe = next((r for r in self.recipes_by_output_item_id.get(item_id, []) if r.id == recipe_id), None)
		if recipe is None:
			return []
		planner = CraftPlanner(self, material_pricing)
		state = Allocation()
		rows = []
		for ingredient in sorted(recipe.ingredients, key=lambda row: row.item_id):
			prior = sum(state.purchase_costs.values())
			prior_steps = len(state.steps)
			state = planner.acquire(ingredient.item_id, ingredient.count, state, frozenset({item_id}))
			cost = sum(state.purchase_costs.values()) - prior
			owned = self.get_owned_count(ingredient.item_id)
			rows.append(dict(item_id=ingredient.item_id, name=self.get_item_name(ingredient.item_id),
			                 count=ingredient.count, owned_count=owned, missing_count=max(0, ingredient.count-owned),
			                 buy_price=self.get_buy_price(ingredient.item_id),
			                 purchase_price=self.get_buy_price(ingredient.item_id) if material_pricing == "buy" else self.get_sell_price(ingredient.item_id),
			                 craft_price=self.calculate_craft_cost(ingredient.item_id, material_pricing),
			                 chosen_source="craft" if len(state.steps) > prior_steps else "buy or leftover",
			                 chosen_unit_cost=cost / ingredient.count, total_cost=cost))
		return rows

	def calculate_profit(self, item_id: int, material_pricing: str = "buy", output_pricing: str = "sell",
	                     liquidation_pricing: str | None = None, recipe_id: int | None = None,
	                     discipline: str | None = None, include_breakdown: bool = True, eligible_only: bool = False) -> dict[str, Any] | None:
		planner = CraftPlanner(self, material_pricing, output_pricing, liquidation_pricing, require_eligible=eligible_only)
		# Do not traverse an entire ingredient graph for an output that cannot be sold.
		if planner.market_total(item_id, 1, output_pricing, True) is None:
			return None
		plan = planner.build(item_id, recipe_id=recipe_id, discipline=discipline, use_owned=eligible_only)
		price_row = self.get_price_row(item_id)
		if plan["purchase_cost"] is None or plan["net_revenue"] is None or price_row is None:
			return None
		recipe = next(r for r in self.recipes_by_output_item_id[item_id] if r.id == plan["recipe_id"])
		output_count = plan["planned_quantity"]
		if eligible_only and (plan["economic_gain"] is None or plan["eligibility"] != "eligible" or plan.get("stale_price_item_ids")):
			return None
		craft_cost = (plan["purchase_cost"] + (plan["owned_sale_value"] if eligible_only else 0)) / output_count
		net_sale = plan["net_revenue"] / output_count
		sale_price = self.get_sell_price(item_id) if output_pricing == "sell" else self.get_buy_price(item_id)
		buy_price, sell_price = self.get_buy_price(item_id), self.get_sell_price(item_id)
		spread = sell_price - buy_price if sell_price and buy_price else None
		spread_ratio = sell_price / buy_price if sell_price and buy_price else None
		# Compare the actual acquired leaf materials, not hypothetical direct ingredients.
		liquidation_values = [planner.market_total(row["item_id"], row["quantity"], planner.liquidation_pricing, True)
		                      for row in plan["purchases"]]
		ingredient_sale = None if any(v is None for v in liquidation_values) else sum(liquidation_values)
		value_add = plan["net_revenue"] - ingredient_sale if ingredient_sale is not None else None
		if eligible_only:
			ingredient_sale = plan["owned_sale_value"]
			value_add = plan["economic_gain"]
		recommendation = "Unknown" if value_add is None else "Craft" if value_add > 0 else "Sell Ingredients" if value_add < 0 else "Break Even"
		profit = net_sale - craft_cost
		return dict(item_id=item_id, name=self.get_item_name(item_id), recipe_id=recipe.id,
		            disciplines=self.parse_disciplines(recipe.disciplines), output_item_count=output_count,
		            craft_cost=round(craft_cost, 2), buy_price=buy_price, sell_price=sale_price,
		            buy_quantity=price_row.buy_quantity or 0, sell_quantity=price_row.sell_quantity or 0,
		            net_sale=round(net_sale, 2), profit=round(profit, 2), roi=round(profit/craft_cost, 4) if craft_cost else None,
		            spread=spread, spread_ratio=round(spread_ratio, 4) if spread_ratio else None,
		            low_liquidity=(price_row.buy_quantity or 0) < 5 or (price_row.sell_quantity or 0) < 5,
		            suspicious_spread=spread_ratio is not None and spread_ratio > 10,
		            has_price_history=item_id in self.price_history_item_ids,
		            **self.market_flow_for_item(item_id),
		            **({"ingredients": self.build_ingredient_breakdown(item_id, material_pricing, recipe.id),
		                "market_plan": plan} if include_breakdown and not eligible_only else {"market_plan": plan} if include_breakdown else {}),
		            ingredient_sale_value=ingredient_sale / output_count if ingredient_sale is not None else None,
		            value_add=value_add / output_count if value_add is not None else None, recommendation=recommendation,
		            crafted_item_value=net_sale, material_pricing=material_pricing,
		            output_pricing=output_pricing, liquidation_pricing=planner.liquidation_pricing,
		            account_id=self.account_id, snapshot_id=self.profile.snapshot_id if self.profile else None,
		            eligibility=plan["eligibility"], quote_basis="account" if eligible_only else "market",
		            eligible_characters=plan["steps"][-1]["eligible_characters"],
		            reservation_revision=self.profile.reservation_revision if self.profile else None, quote_issues=plan["issues"], price_last_updated=self.normalize_datetime(price_row.last_updated))

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
		eligible_only: bool = False,
	) -> list[dict[str, Any]]:
		results: list[dict[str, Any]] = []

		for output_item_id in sorted(self.recipes_by_output_item_id):
			price = self.get_price_row(output_item_id)
			if price is None or (price.buy_quantity or 0) < min_buy_quantity or (price.sell_quantity or 0) < min_sell_quantity:
				continue
			result = self.calculate_profit(
				output_item_id,
				material_pricing=material_pricing,
				output_pricing=output_pricing,
				discipline=discipline,
				include_breakdown=False,
				eligible_only=eligible_only,
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

	def build_market_flow_by_item_id(self, output_item_ids: list[int] | None = None) -> dict[int, dict[str, Any]]:
		if output_item_ids is None:
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
		recipe_id: int | None = None,
		eligible_only: bool = False,
		output_pricing: str = "sell",
	) -> dict[str, Any] | None:
		plan = CraftPlanner(self, material_pricing, output_pricing, require_eligible=eligible_only).build(item_id, recipe_id=recipe_id, use_owned=eligible_only)
		if plan["purchase_cost"] is None or (eligible_only and (plan["owned_sale_value"] is None or plan.get("stale_price_item_ids"))):
			return None
		craft_cost = (plan["purchase_cost"] + (plan["owned_sale_value"] if eligible_only else 0)) / plan["planned_quantity"]

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

			if type(unit_price) is not int or type(quantity) is not int or unit_price <= 0 or quantity <= 0:
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
