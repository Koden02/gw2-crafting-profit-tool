"""Conservative proof of supported crafting steps, using fresh account sources."""
from datetime import datetime, timezone
import json

# Known daily recipes without a complete remaining-allowance API. Block their
# crafting routes; an eligible plan can still buy the intermediate instead.
# Sources: wiki.guildwars2.com/wiki/Server_reset and /wiki/Refinement.
UNVERIFIED_DAILY_OUTPUTS = {
    43772, 46740, 46742, 46744, 46745, 66913, 66917, 66923, 66993, 67015,
    67377, 79726, 79763, 79790, 79795, 79817,
}


def fresh(source, now=None):
    if not isinstance(source, dict) or source.get("status") != "ok" or "data" not in source:
        return False
    try:
        at = datetime.fromisoformat(source["fetched_at"].replace("Z", "+00:00"))
        if at.tzinfo is None:
            return False
        age = ((now or datetime.now(timezone.utc)) - at).total_seconds()
        return -300 <= age <= 3600
    except (ValueError, TypeError, KeyError):
        return False


class CraftingEligibility:
    def __init__(self, engine):
        self.engine = engine
        self.data = engine.crafting_data or {}
        self.cache = {}
        source = self.data.get("account_recipes", {})
        self.account_ids = set(source["data"]) if fresh(source) else set()
        self.character_ids = {name: set(data["recipes"]["data"]) if fresh(data.get("recipes")) else set()
                              for name, data in self.data.get("by_character", {}).items()}

    def evaluate(self, recipe):
        if recipe.id not in self.cache:
            self.cache[recipe.id] = self._evaluate(recipe)
        return self.cache[recipe.id]

    def _evaluate(self, recipe):
        def result(status, state="unknown", characters=None, reason=""):
            return dict(status=status, recipe_state=state, characters=characters or [], reasons=[reason] if reason else [])
        if not self.engine.account_id:
            return result("unchecked", reason="Select an account to verify crafting eligibility.")
        try:
            flags, required = json.loads(recipe.flags), json.loads(recipe.disciplines)
            if not isinstance(flags, list) or not isinstance(required, list) or not required or any(not isinstance(v, str) for v in flags + required) or type(recipe.min_rating) is not int or recipe.min_rating < 0:
                raise ValueError()
        except (TypeError, ValueError):
            return result("unknown", reason="Recipe rating or unlock metadata is missing; sync recipes.")
        if recipe.unsupported_reason or not recipe.ingredients_complete:
            return result("unsupported", reason=recipe.unsupported_reason or "Recipe ingredients are incomplete.")
        if set(flags) - {"AutoLearned", "LearnedFromItem"}:
            return result("unknown", reason="Recipe has unsupported unlock flags.")
        item = self.engine.get_item(recipe.output_item_id)
        if item and "SoulbindOnAcquire" in self.engine.parse_disciplines(item.flags):
            return result("unsupported", reason="Character-bound crafted intermediates require binding-aware routing.")
        roster = self.data.get("characters", {})
        if not fresh(roster):
            return result("unknown", reason="Character roster is missing, stale or its last refresh failed.")
        account_source = self.data.get("account_recipes", {})
        account_known = recipe.id in self.account_ids
        automatic = "AutoLearned" in flags
        eligible, inactive = [], []
        unknown = False
        qualified = False
        for name in roster["data"]:
            character = self.data.get("by_character", {}).get(name, {})
            crafting = character.get("crafting", {})
            if not fresh(crafting):
                unknown = True
                continue
            for discipline in crafting["data"]:
                if discipline["discipline"] not in required or discipline["rating"] < recipe.min_rating:
                    continue
                qualified = True
                char_recipes = character.get("recipes", {})
                char_known = recipe.id in self.character_ids.get(name, set())
                known = automatic or account_known or char_known
                if not known:
                    unknown |= not fresh(char_recipes) or ("LearnedFromItem" in flags and not fresh(account_source))
                    continue
                candidate = dict(name=name, discipline=discipline["discipline"], rating=discipline["rating"],
                                 unlock_source="automatic" if automatic else "account" if account_known else "character")
                (eligible if discipline["active"] else inactive).append(candidate)
        state = "automatic" if automatic else "known" if account_known or eligible or inactive else "unknown" if unknown else "locked"
        if eligible:
            if recipe.output_item_id in UNVERIFIED_DAILY_OUTPUTS or recipe.recipe_type == "RefinementEctoplasm":
                return result("unknown", state, eligible, "Daily crafting allowance cannot be verified; this crafting route is excluded.")
            return result("eligible", state, eligible)
        if unknown:
            return result("unknown", state, reason="Required character or recipe data is missing, stale or failed to refresh.")
        if inactive:
            return result("inactive", state, inactive, "A qualified character must reactivate the discipline; switching costs are not included.")
        if not qualified:
            return result("level_too_low", state, reason="No character has the required crafting discipline and rating.")
        return result("locked", "locked", reason="Recipe is not unlocked/discovered on a qualified character.")
