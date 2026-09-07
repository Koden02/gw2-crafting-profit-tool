"""Validated, account-scoped observations; remote errors never erase a good payload."""
from collections import defaultdict
from datetime import datetime, timezone

import httpx


def positive_int(value, minimum=1):
    return type(value) is int and value >= minimum


def normalize_orders(raw):
    if not isinstance(raw, list):
        raise ValueError("Invalid Trading Post orders.")
    rows, seen = [], set()
    for row in raw:
        if not isinstance(row, dict) or any(not positive_int(row.get(key)) for key in ("id", "item_id", "price", "quantity")):
            raise ValueError("Invalid Trading Post order.")
        try:
            at = datetime.fromisoformat(row["created"].replace("Z", "+00:00"))
            if at.tzinfo is None or row["id"] in seen:
                raise ValueError()
        except (KeyError, TypeError, AttributeError, ValueError) as exc:
            raise ValueError("Duplicate or malformed Trading Post order; refresh again.") from exc
        seen.add(row["id"])
        rows.append({**{key: row[key] for key in ("id", "item_id", "price", "quantity")}, "created": at.isoformat()})
    return sorted(rows, key=lambda row: (row["created"], row["id"]))


def normalize_delivery(raw):
    if not isinstance(raw, dict) or not positive_int(raw.get("coins"), 0) or not isinstance(raw.get("items"), list):
        raise ValueError("Invalid Trading Post delivery.")
    counts = defaultdict(int)
    for row in raw["items"]:
        if not isinstance(row, dict) or not positive_int(row.get("id")) or not positive_int(row.get("count")):
            raise ValueError("Invalid Trading Post delivery item.")
        # Unlike material catalog duplicates, separate delivery rows are additive.
        counts[row["id"]] += row["count"]
    return dict(coins=raw["coins"], items=[dict(item_id=i, quantity=n) for i, n in sorted(counts.items())])


def collect_trading_post(client, api_key):
    started = datetime.now(timezone.utc)
    try:
        payload = dict(buys=normalize_orders(client.fetch_current_orders(api_key, "buys")),
                       sells=normalize_orders(client.fetch_current_orders(api_key, "sells")),
                       delivery=normalize_delivery(client.fetch_delivery(api_key)))
        return dict(status="ok", fetched_at=started, payload=payload, error=None)
    except (httpx.HTTPError, ValueError) as exc:
        denied = isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in {401, 403}
        return dict(status="error", error="Trading Post permission is missing or the key was rejected. Use a key with tradingpost permission."
                    if denied else "Trading Post refresh failed or returned incomplete data. Previous orders were preserved; sync again.")


def trading_post_status(row, profile):
    at = row.fetched_at.replace(tzinfo=timezone.utc) if row and row.fetched_at else None
    age = (datetime.now(timezone.utc) - at).total_seconds() if at else None
    same_snapshot = bool(row and profile and row.snapshot_id == profile.snapshot_id)
    fresh = bool(row and row.status == "ok" and same_snapshot and age is not None and -300 <= age <= 600)
    return dict(fresh=fresh, status=row.status if row else "missing", fetched_at=at.isoformat() if at else None,
                snapshot_id=row.snapshot_id if row else None,
                error=row.error if row else None, matches_inventory=same_snapshot,
                note="GW2 orders can be cached for five minutes. After trading or collecting, allow the cache to update and sync inventory and Trading Post together.")
