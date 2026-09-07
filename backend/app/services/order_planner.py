"""Conditional buy-order plans with separate pending, pickup and new funding ledgers."""
from collections import defaultdict

from app.services.craft_planner import Allocation, CraftPlanner


class OrderAwarePlanner(CraftPlanner):
    def book(self, item_id):
        book = super().book(item_id)
        if (not isinstance(book, dict) or book.get("id", item_id) != item_id
                or any(not isinstance(book.get(side), list) for side in ("buys", "sells"))
                or any(not isinstance(r, dict) or type(r.get("unit_price")) is not int or r["unit_price"] <= 0
                       or type(r.get("quantity")) is not int or r["quantity"] < 0
                       for side in ("buys", "sells") for r in book.get(side, []))):
            self.books[item_id] = None
            return None
        return book

    def market_total(self, item_id, count, mode, selling):
        if count and not selling and mode == "buy" and self.listing_provider:
            # A bid is a proposed order price, not a quantity available to purchase.
            item = self.engine.get_item(item_id)
            flags = self.engine.parse_disciplines(item.flags if item else None)
            if not item or {"AccountBound", "SoulbindOnAcquire"}.intersection(flags):
                return None
            book = self.book(item_id)
            if not isinstance(book, dict) or not isinstance(book.get("buys"), list):
                return None
            levels = book["buys"]
            if any(not isinstance(r, dict) or type(r.get("unit_price")) is not int or r["unit_price"] <= 0
                   or type(r.get("quantity")) is not int or r["quantity"] < 0 for r in levels):
                return None
            prices = [r["unit_price"] for r in levels if r["quantity"] > 0]
            return count * max(prices) if prices else None
        return super().market_total(item_id, count, mode, selling)

    def build(self, item_id, quantity=1, use_owned=False, budget=None, **kwargs):
        plan = super().build(item_id, quantity, use_owned=use_owned, budget=None, **kwargs)
        plan["budget"] = budget
        if self.material_pricing != "buy" or not use_owned or not self.engine.trading_post_status["fresh"]:
            plan.update(status="unavailable", economic_gain=None, additional_gold_needed=None, within_budget=None)
            plan["issues"].append("Sync account data with Trading Post included before using pending orders and pickups.")
            return plan
        if plan["status"] != "quoted":
            plan["within_budget"] = None
            return plan

        payload = self.engine.trading_post
        deliveries = {r["item_id"]: r["quantity"] for r in payload["delivery"]["items"]}
        orders = defaultdict(list)
        for row in payload["buys"]:
            orders[row["item_id"]].append(row)
        consumed = {r["item_id"]: r["quantity"] for r in plan["consumed"]}
        new_cost, committed_cost, pickup_total, pending_total = 0, 0, 0, 0
        for row in plan["purchases"]:
            material = row["item_id"]
            holding = self.engine.holdings_by_item_id.get(material)
            # A reservation above today's usable inventory also protects future supply.
            protected = max(0, self.engine.reservations.get(material, 0) - (holding.usable_count if holding else 0))
            pickup_available = deliveries.get(material, 0)
            protected_pickup = min(protected, pickup_available)
            pickup = min(row["quantity"], pickup_available - protected_pickup)
            protected -= protected_pickup
            remaining = row["quantity"] - pickup
            allocated, pending_cost = [], 0
            for order in orders[material]:
                protected_order = min(protected, order["quantity"])
                protected -= protected_order
                take = min(remaining, order["quantity"] - protected_order)
                if take:
                    allocated.append(dict(order_id=order["id"], quantity=take, unit_price=order["price"]))
                    pending_cost += take * order["price"]
                    remaining -= take
            target = row["cost"] / row["quantity"]
            cost = remaining * target
            pending = row["quantity"] - pickup - remaining
            row.update(pickup_quantity=pickup, pending_quantity=pending, new_order_quantity=remaining,
                       target_unit_price=target, new_order_cost=cost, committed_cost=pending_cost,
                       orders=allocated, cost=cost + pending_cost)
            consumed[material] = consumed.get(material, 0) + pickup
            new_cost += cost
            committed_cost += pending_cost
            pickup_total += pickup
            pending_total += pending
        owned_value = self.value_consumed(Allocation(consumed=consumed))
        fees = plan["additional_gold_needed"] - plan["purchase_cost"]
        plan.update(purchase_cost=new_cost + committed_cost, owned_sale_value=owned_value,
                    additional_gold_needed=new_cost + fees,
                    within_budget=None if budget is None else new_cost + fees <= budget,
                    cash_surplus=plan["net_revenue"] - new_cost - committed_cost,
                    economic_gain=None if owned_value is None else plan["net_revenue"] - new_cost - committed_cost - owned_value,
                    procurement=dict(new_order_cost=new_cost, committed_cost=committed_cost, listing_fees=fees,
                                     pickup_quantity=pickup_total, pending_quantity=pending_total,
                                     state="place_orders" if new_cost else "waiting_for_orders" if pending_total else "collect_items" if pickup_total else "ready",
                                     fetched_at=self.engine.trading_post_status["fetched_at"],
                                     snapshot_id=self.engine.trading_post_status["snapshot_id"]))
        if owned_value is None:
            plan["status"] = "incomplete"
            plan["issues"].append("The combined inventory and pickup resale value could not be verified.")
        if budget is not None and not plan["within_budget"]:
            plan["issues"].append("Budget is insufficient for new orders and output listing fees.")
        plan["issues"].extend([
            "Conditional estimate: buy orders must fill and pickups must be collected. Today's output bids may change before you can sell.",
            self.engine.trading_post_status["note"],
            "Material outlay includes allocated pending orders at their existing prices. New gold needed excludes that already committed money. Pickups are valued at their resale value, not treated as free profit.",
        ])
        plan["allocation_policy"] += " Pending orders and pickups cover the selected shopping route; each quote uses them independently. No orders or inventory are changed."
        return plan
