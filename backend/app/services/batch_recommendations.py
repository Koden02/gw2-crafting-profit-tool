"""Bounded, single-craft batch suggestions using current two-sided order books."""
from datetime import datetime, timezone
from time import monotonic

from app.services.craft_planner import CraftPlanner
from app.services.inventory_coverage import inventory_coverage


class BatchRecommendations:
    MAX_CANDIDATES = 12
    MAX_BOOKS = 80
    MAX_SECONDS = 35

    def __init__(self, engine, listing_provider):
        self.engine = engine
        self.provider = listing_provider
        self.books = {}
        self.failures = set()
        self.started = monotonic()
        self.deadline = self.started + self.MAX_SECONDS
        self.limited = False
        self.first_book_at = None
        self.last_book_at = None

    def book(self, item_id):
        if item_id in self.books:
            return self.books[item_id]
        if len(self.books) >= self.MAX_BOOKS or monotonic() >= self.deadline:
            self.limited = True
            raise ValueError("Market lookup limit reached")
        self.books[item_id] = None  # Failed requests also count against the limit.
        try:
            book = self.provider(item_id)
            if not isinstance(book, dict) or book.get("id", item_id) != item_id:
                raise ValueError("Invalid order book")
            for side in ("buys", "sells"):
                if not isinstance(book.get(side), list):
                    raise ValueError("Missing market side")
                if any(not isinstance(row, dict) or type(row.get("unit_price")) is not int
                       or row["unit_price"] <= 0 or type(row.get("quantity")) is not int
                       or row["quantity"] < 0 for row in book[side]):
                    raise ValueError("Malformed market level")
            self.books[item_id] = book
            observed = datetime.now(timezone.utc).isoformat()
            self.first_book_at = self.first_book_at or observed
            self.last_book_at = observed
            return book
        except Exception:
            self.failures.add(item_id)
            raise

    @staticmethod
    def acceptable(plan, minimum_gain):
        return (plan["status"] == "quoted" and plan["eligibility"] == "eligible"
                and plan["within_budget"] is True and plan["economic_gain"] >= minimum_gain
                and not plan.get("stale_price_item_ids"))

    def find(self, budget, minimum_gain=1, max_output=100, limit=5):
        if (type(budget) is not int or budget <= 0 or type(minimum_gain) is not int or minimum_gain < 1
                or type(max_output) is not int or not 1 <= max_output <= 200
                or type(limit) is not int or not 1 <= limit <= 5):
            raise ValueError("Enter a positive budget and minimum gain, and a batch cap from 1 to 200.")
        coverage = inventory_coverage(self.engine.profile)
        response = dict(account_id=self.engine.account_id,
                        snapshot_id=self.engine.profile.snapshot_id if self.engine.profile else None,
                        reservation_revision=self.engine.profile.reservation_revision if self.engine.profile else None,
                        budget=budget, minimum_gain=minimum_gain, max_output=max_output,
                        observed_at=datetime.now(timezone.utc).isoformat(), inventory_coverage=coverage,
                        suggestions=[], issues=[], candidate_limit=self.MAX_CANDIDATES,
                        candidate_count=0, candidates_checked=0, quantities_checked=0,
                        search_limited=False, shortlist_truncated=False,
                        scope="Independent crafts; a bounded shortlist and whole batches, not a global optimum or combined basket.")
        if not self.engine.profile or self.engine.holdings_are_stale() or not coverage["complete"]:
            response["issues"] = ["Sync account data with bank, materials, shared and all character inventories before finding batches."]
            return response

        # Cached prices only screen candidates. Every returned total is recalculated
        # with live asks (purchases) and live bids (sales and owned-stock valuation).
        candidates = []
        stale_candidates = False
        for item_id, recipes in sorted(self.engine.recipes_by_output_item_id.items()):
            if monotonic() >= self.deadline:
                self.limited = True
                break
            if not self.engine.get_buy_price(item_id):
                continue
            for recipe in recipes:
                if monotonic() >= self.deadline:
                    self.limited = True
                    break
                if not 1 <= recipe.output_item_count <= max_output or self.engine.eligibility.evaluate(recipe)["status"] != "eligible":
                    continue
                estimate = CraftPlanner(self.engine, "sell", "buy", "buy", require_eligible=True).build(
                    item_id, recipe.output_item_count, recipe_id=recipe.id, use_owned=True)
                if estimate["status"] != "quoted" or estimate["eligibility"] != "eligible":
                    continue
                if estimate.get("stale_price_item_ids"):
                    stale_candidates = True
                    continue
                candidates.append((estimate["economic_gain"] / estimate["planned_quantity"], item_id, recipe))
        response["candidate_count"] = len(candidates)
        response["shortlist_truncated"] = len(candidates) > self.MAX_CANDIDATES
        candidates.sort(key=lambda row: (-row[0], row[1], row[2].id))
        best_by_item = {}
        for _, item_id, recipe in candidates[:self.MAX_CANDIDATES]:
            if monotonic() >= self.deadline:
                self.limited = True
                break
            response["candidates_checked"] += 1
            planner = CraftPlanner(self.engine, "sell", "buy", "buy", listing_provider=self.book, require_eligible=True)
            planner.depth_deadline = self.deadline
            best, best_rank = None, None
            trials = {}
            # Do not binary-search affordability/profit: whole intermediate batches
            # and alternate routes make those functions non-monotonic.
            for quantity in range(recipe.output_item_count, max_output + 1, recipe.output_item_count):
                if monotonic() >= self.deadline:
                    self.limited = True
                    break
                plan = planner.build(item_id, quantity, use_owned=True, budget=budget, recipe_id=recipe.id)
                response["quantities_checked"] += 1
                trials[quantity] = plan
                if self.acceptable(plan, minimum_gain):
                    rank = (plan["economic_gain"], -plan["additional_gold_needed"], -plan["planned_quantity"])
                    if best_rank is None or rank > best_rank:
                        best, best_rank = plan, rank
            if best is None:
                continue
            next_plan = trials.get(best["planned_quantity"] + recipe.output_item_count)
            if next_plan is None:
                reason = "Batch cap reached" if best["planned_quantity"] + recipe.output_item_count > max_output else "Search limit reached"
            elif next_plan["additional_gold_needed"] is not None and next_plan["additional_gold_needed"] > budget:
                reason = "The next batch exceeds your budget"
            elif next_plan["status"] != "quoted":
                reason = "The next batch has insufficient market depth or an unavailable route"
            else:
                reason = "Larger tested batches do not improve total gain"
            suggestion = dict(plan=best, quantity_limit_reason=reason)
            prior = best_by_item.get(item_id)
            if prior is None or best_rank > prior[0]:
                best_by_item[item_id] = (best_rank, suggestion)
        response["suggestions"] = [row[1] for row in sorted(best_by_item.values(), key=lambda row: row[0], reverse=True)[:limit]]
        response.update(search_limited=self.limited, books_checked=len(self.books), failed_books=len(self.failures),
                        market_observed_from=self.first_book_at, market_observed_to=self.last_book_at,
                        elapsed_seconds=round(monotonic() - self.started, 2))
        if self.limited:
            response["issues"].append("Search limit reached; results cover only the completed checks.")
        if self.failures:
            response["issues"].append("Some market books failed validation or could not be fetched; affected quotes were excluded.")
        if stale_candidates:
            response["issues"].append("Some cached prices are stale. Refresh prices to include those candidates.")
        if not response["suggestions"]:
            response["issues"].append("No qualifying batch was found in the checked shortlist. Try a lower minimum gain or refresh your data.")
        return response
