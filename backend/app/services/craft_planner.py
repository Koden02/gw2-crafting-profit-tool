"""Quantity-aware acquisition plans shared by market quotes and account shopping lists.

Routes are evaluated deterministically with a shared stock/depth ledger. This is
a bounded single-output planner, not a global portfolio or integer optimizer.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
from time import monotonic
from typing import Any, Callable


class PlanUnavailable(ValueError):
    pass


@dataclass
class Allocation:
    owned: dict[int, int] = field(default_factory=dict)
    leftovers: dict[int, int] = field(default_factory=dict)
    consumed: dict[int, int] = field(default_factory=dict)
    purchases: dict[int, int] = field(default_factory=dict)
    purchase_costs: dict[int, float] = field(default_factory=dict)
    steps: list[dict[str, Any]] = field(default_factory=list)


class CraftPlanner:
    def __init__(self, engine: Any, material_pricing: str = "buy", output_pricing: str = "sell",
                 liquidation_pricing: str | None = None,
                 listing_provider: Callable[[int], dict] | None = None,
                 require_eligible: bool = False, inventory_only: bool = False) -> None:
        self.engine = engine
        self.material_pricing = material_pricing
        self.output_pricing = output_pricing
        self.liquidation_pricing = liquidation_pricing or output_pricing
        if any(mode not in {"buy", "sell"} for mode in
               (material_pricing, output_pricing, self.liquidation_pricing)):
            raise ValueError("Pricing mode must be buy or sell.")
        self.listing_provider = listing_provider
        self.require_eligible = require_eligible
        self.inventory_only = inventory_only
        self.books: dict[int, dict | None] = {}
        self.expansions = 0
        self.search_limited = False
        self.depth_deadline = monotonic() + 15

    def book(self, item_id: int) -> dict | None:
        if item_id not in self.books:
            if len(self.books) >= 40 or monotonic() > self.depth_deadline:
                self.search_limited = True
                return None
            try:
                self.books[item_id] = self.listing_provider(item_id) if self.listing_provider else None
            except Exception:
                # Never fall back to top-of-book numbers as if depth had been verified.
                self.books[item_id] = None
        return self.books[item_id]

    def market_total(self, item_id: int, count: int, mode: str, selling: bool) -> float | None:
        if count == 0:
            return 0.0
        item = self.engine.get_item(item_id)
        flags = self.engine.parse_disciplines(item.flags if item else None)
        if not item or "AccountBound" in flags or "SoulbindOnAcquire" in flags:
            return None
        instant = (selling and mode == "buy") or (not selling and mode == "sell")
        if self.listing_provider and instant:
            book = self.book(item_id)
            if book is None:
                return None
            remaining, total = count, 0.0
            levels = self.engine.normalize_listing_levels(book.get("buys" if selling else "sells", []),
                                                          reverse=selling)
            for level in levels:
                take = min(remaining, level["quantity"])
                unit = self.engine.trading_post_net(level["unit_price"]) if selling else level["unit_price"]
                total += take * unit
                remaining -= take
                if remaining == 0:
                    return total
            return None
        price = self.engine.get_buy_price(item_id) if mode == "buy" else self.engine.get_sell_price(item_id)
        if price is None:
            return None
        return float(count * (self.engine.trading_post_net(price) if selling else price))

    def value_consumed(self, state: Allocation) -> float | None:
        values = [self.market_total(i, n, self.liquidation_pricing, True)
                  for i, n in state.consumed.items()]
        return None if any(v is None for v in values) else sum(values)

    def score(self, state: Allocation) -> float:
        value = self.value_consumed(state)
        return sum(state.purchase_costs.values()) + (value if value is not None else math.inf)

    def craft(self, recipe: Any, count: int, state: Allocation, path: frozenset[int]) -> Allocation:
        eligibility = self.engine.eligibility.evaluate(recipe)
        if self.require_eligible and eligibility["status"] != "eligible":
            raise PlanUnavailable(f"Recipe {recipe.id}: " + "; ".join(eligibility["reasons"]))
        if not recipe.ingredients_complete:
            raise PlanUnavailable("Recipe cache needs a fresh recipe sync before quoting.")
        if recipe.unsupported_reason:
            raise PlanUnavailable(recipe.unsupported_reason)
        if recipe.output_item_count <= 0 or not recipe.ingredients:
            raise PlanUnavailable("Recipe has an invalid output count or no supported ingredients.")
        runs = math.ceil(count / recipe.output_item_count)
        trial = deepcopy(state)
        for ingredient in sorted(recipe.ingredients, key=lambda row: row.item_id):
            if ingredient.count <= 0:
                raise PlanUnavailable("Recipe has an invalid ingredient count.")
            trial = self.acquire(ingredient.item_id, ingredient.count * runs, trial, path)
        produced = runs * recipe.output_item_count
        trial.leftovers[recipe.output_item_id] = trial.leftovers.get(recipe.output_item_id, 0) + produced - count
        trial.steps.append(dict(recipe_id=recipe.id, item_id=recipe.output_item_id,
                                name=self.engine.get_item_name(recipe.output_item_id),
                                runs=runs, produced=produced, required=count,
                                eligibility=eligibility["status"], recipe_state=eligibility["recipe_state"],
                                eligible_characters=eligibility["characters"],
                                crafter=eligibility["characters"][0]["name"] if eligibility["status"] == "eligible" else None,
                                eligibility_reasons=eligibility["reasons"]))
        return trial

    def acquire(self, item_id: int, count: int, state: Allocation,
                path: frozenset[int]) -> Allocation:
        self.expansions += 1
        if self.expansions > 5000 or len(path) > 40:
            self.search_limited = True
            raise PlanUnavailable("Recipe search limit reached; narrow the requested craft.")
        state = deepcopy(state)
        surplus = min(count, state.leftovers.get(item_id, 0))
        state.leftovers[item_id] = state.leftovers.get(item_id, 0) - surplus
        count -= surplus
        owned = min(count, state.owned.get(item_id, 0))
        if owned:
            state.owned[item_id] -= owned
            state.consumed[item_id] = state.consumed.get(item_id, 0) + owned
            count -= owned
        if count == 0:
            return state

        candidates: list[tuple[float, int, Allocation]] = []
        already_bought = state.purchases.get(item_id, 0)
        cost = None if self.inventory_only else self.market_total(item_id, already_bought + count, self.material_pricing, False)
        if cost is not None:
            trial = deepcopy(state)
            trial.purchases[item_id] = already_bought + count
            trial.purchase_costs[item_id] = cost
            candidates.append((self.score(trial), -1, trial))
        errors = []
        if item_id not in path:
            for recipe in self.engine.recipes_by_output_item_id.get(item_id, []):
                try:
                    trial = self.craft(recipe, count, state, path | {item_id})
                    candidates.append((self.score(trial), recipe.id, trial))
                except PlanUnavailable as exc:
                    errors.append(str(exc))
        if not candidates:
            suffix = "; ".join(sorted(set(errors))) or (
                "not enough usable inventory or an available crafting route" if self.inventory_only
                else "no purchase quote or acyclic crafting route")
            raise PlanUnavailable(f"{self.engine.get_item_name(item_id)}: {suffix}.")
        return min(candidates, key=lambda c: (c[0], c[1]))[2]

    def build(self, item_id: int, quantity: int = 1, use_owned: bool = False,
              budget: int | None = None, recipe_id: int | None = None,
              discipline: str | None = None) -> dict[str, Any]:
        if type(quantity) is not int or not 1 <= quantity <= 100000:
            raise ValueError("Quantity must be an integer between 1 and 100000.")
        if self.inventory_only and (not use_owned or not self.engine.account_id):
            raise ValueError("Select an account to craft from inventory.")
        self.expansions = 0
        self.search_limited = False
        now = datetime.now(timezone.utc)
        starting = {i: self.engine.get_owned_count(i) for i in self.engine.holdings_by_item_id} if use_owned else {}
        initial = Allocation(owned=starting)
        candidates = []
        errors = []
        for recipe in self.engine.recipes_by_output_item_id.get(item_id, []):
            if recipe_id is not None and recipe.id != recipe_id:
                continue
            if discipline and discipline.lower() not in [d.lower() for d in self.engine.parse_disciplines(recipe.disciplines)]:
                continue
            try:
                trial = self.craft(recipe, quantity, initial, frozenset({item_id}))
                candidates.append((self.score(trial), recipe.id, trial, recipe))
            except PlanUnavailable as exc:
                errors.append(str(exc))
        base = dict(item_id=item_id, name=self.engine.get_item_name(item_id),
                    inventory_only=self.inventory_only,
                    account_id=self.engine.account_id if use_owned else None,
                    snapshot_id=self.engine.profile.snapshot_id if use_owned and self.engine.profile else None,
                    reservation_revision=self.engine.profile.reservation_revision if use_owned and self.engine.profile else None,
                    requested_quantity=quantity, material_pricing=self.material_pricing,
                    output_pricing=self.output_pricing, liquidation_pricing=self.liquidation_pricing,
                    observed_at=now.isoformat(), eligibility="unchecked",
                    fee_model="Per-unit copper fee estimate; actual transaction grouping may differ.",
                    allocation_policy="Whole batches; use available owned stock first; deterministic branch choices, not a global optimum; leftovers are not credited as profit.")
        if self.search_limited:
            errors = ["Recipe search/depth limit reached; no complete quote was produced."]
            candidates = []
        if self.require_eligible and use_owned and self.engine.holdings_are_stale():
            errors = ["Account holdings are missing or stale. Sync account data before requesting an eligible plan."]
            candidates = []
        if not candidates:
            return {**base, "status": "unavailable", "issues": sorted(set(errors)) or ["No supported recipe."],
                    "eligibility": "unknown" if self.engine.account_id else "unchecked", "reserved": [],
                    "purchases": [], "consumed": [], "steps": [], "leftovers": [],
                    "purchase_cost": None, "net_revenue": None, "economic_gain": None,
                    "cash_surplus": None, "additional_gold_needed": None, "owned_sale_value": None,
                    "planned_quantity": 0, "recipe_id": recipe_id}
        _, _, state, recipe = min(candidates, key=lambda c: (c[0], c[1]))
        produced = state.steps[-1]["produced"]
        # Root overproduction is part of the output sale, not an intermediate leftover.
        state.leftovers[item_id] = state.leftovers.get(item_id, 0) - (produced - quantity)
        revenue = self.market_total(item_id, produced, self.output_pricing, True)
        purchase_cost = sum(state.purchase_costs.values())
        owned_value = self.value_consumed(state)
        cash_surplus = revenue - purchase_cost if revenue is not None else None
        gain = cash_surplus - owned_value if cash_surplus is not None and owned_value is not None else None
        step_statuses = {step["eligibility"] for step in state.steps}
        eligibility_status = "eligible" if step_statuses == {"eligible"} else "unchecked" if not self.engine.account_id else "unknown" if "unknown" in step_statuses else "blocked"
        issues = []
        if eligibility_status != "eligible":
            issues.append("Crafting eligibility is not verified for every step.")
            issues.extend(sorted({reason for step in state.steps for reason in step["eligibility_reasons"]}))
        if self.search_limited:
            issues.append("Depth lookup limit reached; sale or liquidation quote is incomplete.")
        if revenue is None:
            issues.append("Output sale quote unavailable or requested quantity exceeds current bid depth.")
        if owned_value is None:
            issues.append("Owned-material liquidation value is unavailable for this quantity.")
        if self.material_pricing == "buy" and not self.inventory_only:
            issues.append("Buy orders require future fills; material availability is not guaranteed.")
        if self.output_pricing == "sell" or (state.consumed and self.liquidation_pricing == "sell"):
            issues.append("Sell-list values assume a future buyer; no sale speed or sale quantity is guaranteed.")
        if not self.listing_provider:
            issues.append("Top-of-book estimate only; purchase and sale depth have not been checked.")
        used_ids = set(state.purchases) | set(state.consumed) | {item_id}
        stale_ids = [i for i in sorted(used_ids) if self.engine.price_is_stale(i)]
        if stale_ids:
            issues.append("Stale or missing cached prices: " + ", ".join(map(str, stale_ids)) + ".")
        if use_owned:
            issues.append("Only synced unbound inventory is allocated; bound items, equipment and account reservations are excluded.")
            if self.engine.holdings_are_stale():
                issues.append("Account holdings are stale; refresh before buying or crafting.")
        # Fees need funding before the sale. Do not subtract these from net revenue a second time.
        if revenue is not None:
            if self.listing_provider and self.output_pricing == "buy":
                book = self.book(item_id)
                remaining, upfront = produced, 0
                for level in self.engine.normalize_listing_levels(book.get("buys", []), reverse=True):
                    take = min(remaining, level["quantity"])
                    upfront += take * self.engine.listing_fee(level["unit_price"])
                    remaining -= take
                    if not remaining:
                        break
            else:
                sale_price = self.engine.get_sell_price(item_id) if self.output_pricing == "sell" else self.engine.get_buy_price(item_id)
                upfront = self.engine.listing_fee(sale_price) * produced
            needed = purchase_cost + upfront
        else:
            needed = None
        if budget is not None and (needed is None or needed > budget):
            issues.append("Budget is insufficient or the required upfront gold is unknown.")
        rows = lambda counts: [dict(item_id=i, name=self.engine.get_item_name(i), quantity=n)
                               for i, n in sorted(counts.items()) if n > 0]
        purchases = rows(state.purchases)
        consumed = rows(state.consumed)
        for row in consumed:
            row["locations"] = self.engine.owned_locations(row["item_id"], row["quantity"])
        for row in purchases:
            row["cost"] = state.purchase_costs[row["item_id"]]
        relevant_ids = used_ids | {step["item_id"] for step in state.steps}
        reserved = rows({i: n for i, n in self.engine.reservations.items() if use_owned and i in relevant_ids})
        if reserved:
            issues.append("Reserved stock is unavailable to this plan; replacement materials may need to be bought or crafted.")
        return {**base, "eligibility": eligibility_status, "reserved": reserved, "status": "quoted" if revenue is not None and owned_value is not None else "incomplete",
                "recipe_id": recipe.id, "planned_quantity": produced,
                "output_per_run": recipe.output_item_count, "root_runs": state.steps[-1]["runs"],
                "purchase_cost": purchase_cost, "net_revenue": revenue, "owned_sale_value": owned_value,
                "economic_gain": gain, "cash_surplus": cash_surplus, "additional_gold_needed": needed,
                "budget": budget, "within_budget": None if budget is None or needed is None else needed <= budget,
                "stale_price_item_ids": stale_ids, "issues": issues,
                "purchases": purchases, "consumed": consumed,
                "steps": state.steps, "leftovers": rows(state.leftovers)}
