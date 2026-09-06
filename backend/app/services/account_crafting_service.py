"""Direct API adapter for capability data, separate from physical inventory."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import httpx


def recipe_ids(raw):
    if not isinstance(raw, list) or any(type(i) is not int or i <= 0 for i in raw):
        raise ValueError("Invalid recipe IDs")
    return sorted(set(raw))


def character_names(raw):
    if not isinstance(raw, list) or len(raw) > 100 or any(not isinstance(n, str) or not n.strip() for n in raw) or len(set(raw)) != len(raw):
        raise ValueError("Invalid character roster")
    return sorted(raw)


def disciplines(raw):
    rows = raw.get("crafting") if isinstance(raw, dict) else None
    if not isinstance(rows, list):
        raise ValueError("Missing crafting disciplines")
    seen = set()
    result = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("discipline"), str) or not row["discipline"]:
            raise ValueError("Invalid discipline")
        if type(row.get("rating")) is not int or row["rating"] < 0 or type(row.get("active")) is not bool or row["discipline"] in seen:
            raise ValueError("Incomplete crafting rating/active state")
        seen.add(row["discipline"])
        result.append({k: row[k] for k in ("discipline", "rating", "active")})
    return result


def collect_source(fetch, normalize, previous=None):
    attempted = datetime.now(timezone.utc).isoformat()
    try:
        return dict(status="ok", fetched_at=attempted, data=normalize(fetch()))
    except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
        denied = isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in {401, 403}
        # Retain last successful data and time, but never treat a failed refresh as
        # fresh proof. Do not store exception strings that might contain credentials.
        return {**(previous or {}), "status": "error", "attempted_at": attempted,
                "error": "Missing API permissions." if denied else "Source unavailable or malformed; refresh again."}


def collect_crafting(client, api_key, previous=None, roster=None):
    previous = previous or {}
    roster = roster if roster is not None else collect_source(lambda: client.fetch_character_names(api_key), character_names, previous.get("characters"))
    account_recipes = collect_source(lambda: client.fetch_account_recipes(api_key), recipe_ids, previous.get("account_recipes"))
    prior_characters = previous.get("by_character", {})
    if roster["status"] != "ok":
        return dict(characters=roster, account_recipes=account_recipes, by_character=prior_characters)

    def collect_character(name):
        prior = prior_characters.get(name, {})
        return name, dict(
            crafting=collect_source(lambda: client.fetch_character_crafting(api_key, name), disciplines, prior.get("crafting")),
            recipes=collect_source(lambda: client.fetch_character_recipes(api_key, name),
                lambda raw: recipe_ids(raw["recipes"]), prior.get("recipes")),
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        by_character = dict(pool.map(collect_character, roster["data"]))
    return dict(characters=roster, account_recipes=account_recipes, by_character=by_character)
