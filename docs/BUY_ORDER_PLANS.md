# Buy-order crafting plans

Implemented on `codex/buy-order-planning`, September 2026. This extends the
[single-craft batch workflow](CRAFT_BATCHES.md) with optional account Trading Post
observations and conditional buy-order estimates. It does not place or cancel orders.

## Using it

1. Select the intended account. Enter a key with the existing `account`,
   `inventories`, `characters` and `unlocks` permissions plus `tradingpost`.
2. Enable **Include Trading Post orders and pickups**, then **Sync Account Data**.
   The option is remembered per account; the key is used for that refresh only.
3. Expand **Your Trading Post orders and pickups**. Verify open buys, sell listings,
   pickup items and the successful-read time against the game.
4. Choose **Buy orders + pending purchases** in **Material strategy**. Enter the
   amount of new gold you are willing to commit, minimum total gain and output cap.
5. Find a batch and **Review and refresh plan**. Its procurement table divides each
   missing material into **Pickup**, **Pending**, and **Order now**, with a target
   unit price. These three quantities sum to **Needed** after usable inventory.
6. Place only the remaining orders in game. Wait for fills, collect purchases,
   allow the API cache to update, and sync again before crafting. Recheck prices
   before selling. Output values describe current bids, not promised future buyers.

The original **Buy instantly** strategy remains available without Trading Post
permission and continues to allocate physical inventory only.

## Observations and failure handling

The adapter reads both paginated current-order endpoints and the delivery endpoint
using authorization headers. All pages must complete with consistent page/result
totals. Duplicate transaction IDs, malformed values, missing headers, HTTP failures
or exhausted page/time bounds reject the Trading Post refresh. Each order side is
bounded to 50 pages of 200 rows, 60 seconds and at most ten seconds per in-flight
request. One sync can therefore take longer than one minute across both sides.

The successful payload is stored in `account_trading_post`, keyed by account ID
and associated with the same local inventory snapshot. Migration v4 adds this table
without rebuilding existing tables. Database files and backups remain local and
ignored by Git. Orders and pickups are never inserted into inventory holdings.

Trading Post reads are optional: a failure preserves the prior payload and its
successful-read time, marks it unusable for planning, and still permits a valid
inventory refresh. A sync without Trading Post leaves the old observation attached
to its older inventory snapshot. Missing, failed, mismatched or older-than-ten-minute
Trading Post data cannot fund a new buy-order plan. Five minutes of future clock
tolerance is allowed. The original inventory/crafting freshness rules also apply.

GW2 can cache transactions for five minutes. Local synchronization is not an atomic
game-side snapshot: trading, collecting or moving items during a refresh can make
sources disagree. The UI explicitly asks users to let the cache update and sync
together after these actions. A local account/reservation revision change during
search or an individual quote rejects the result with HTTP 409.

Separate delivery rows for the same item are added together, following the delivery
schema. This differs from the repeated material-catalog categories handled by the
inventory importer. Account selection and verification remain mandatory.

Sources: [current and historical transactions](https://wiki-en.guildwars2.com/wiki/API%3A2/commerce/transactions),
[delivery](https://wiki.guildwars2.com/wiki/API%3A2/commerce/delivery).

## Allocation and money

The existing planner chooses a supported recipe route and allocates physical stock
once. The order-aware extension then covers the resulting missing-material list
using pickups, followed by pending orders in creation/ID order, then new orders.
Reservations above current usable inventory protect that excess quantity from
pickups and pending orders too. An order can contribute only its allocated quantity;
other quantities and orders remain unassigned. Sell listings are displayed only.

New order targets join the highest observed bid without an automatic increment.
Bid quantities represent competition, not stock available to buy or a fill forecast.
Fresh live books establish material targets and current output/stock resale values
for returned suggestions; missing or malformed books have no cached fallback.

| Figure | Meaning |
| --- | --- |
| Material outlay | Allocated pending quantity at its existing order price, plus new orders at target prices |
| New gold needed | New orders plus output listing fees; previously committed gold is not charged twice |
| Inventory + pickup resale value | Combined liquidation value of physical stock and pickups consumed by this plan |
| Cash surplus | Net output proceeds after both fees minus material outlay, including pending commitments |
| Conditional gain | Cash surplus minus inventory and pickup resale value |

Inventory and pickups share liquidation depth for each item. Pickups have no
historical cost in the delivery API, so their resale value is used like other owned
stock. They are not counted as free profit. Pickup coins are displayed separately
and are never silently added to the manually entered gold budget.

Readiness is explicit: place remaining orders, wait for pending orders, collect
pickups, or all materials present in synced inventory. A waiting/collection state
does not prove the account can craft immediately. Prices and fees are estimates;
the existing per-unit fee rounding limitation remains.

Each suggestion is independent. The bounded shortlist, quantity checks and local
recipe choices remain; the extension does not optimize routes around every possible
pending intermediate, combine several crafts, forecast fill times, or reconcile
transaction history. Saved completed results remain browser-local. When recording
actual purchases for this quote, include its pending and new orders but exclude
items already awaiting pickup at quote time, since their value is in owned stock.

## API

- `POST /api/account/sync/holdings` adds `include_trading_post` (default false).
  The response reports `trading_post_status` and any sanitized error independently.
- `GET /api/account/trading-post?account_id=...` returns scoped observations,
  source status, names and totals. Retained stale rows are labelled and not allocated.
- `POST /api/craft-recommendations` adds `material_pricing`: `sell` retains instant
  purchases; `buy` uses order-aware planning. Both use current instant-sell output.
- `GET /api/profit/{item_id}/plan` adds `use_trading_post=true`, requiring an account,
  `material_pricing=buy` and `output_pricing=buy`. The frontend requests live books
  for the initial plan, quantity edits and refreshes.

## Validation

173 backend tests pass, including item-scoped quote equivalence, database lock waits/recovery, distinct pending/new funding, pickup valuation,
shared liquidation depth, over-reservations, fresh empty sources, account isolation,
failed/partial refresh preservation, paginated reads, unknown/stale coverage,
invalid live books, migration repeatability, supply transitions, quote/search
agreement and concurrent reservation rejection. Frontend lint and build pass.

The isolated browser check uses synthetic A/B accounts and mocked GW2 responses.
It verifies strategy selection, procurement quantities, refreshed quote agreement,
account switching and the optional account-sync control. This does not establish
real Trading Post key permissions, remote pagination or actual market fills.

The next user-assisted check is a sync with `tradingpost` permission, comparison of
orders/pickups to the game, and one small completed craft and sale. Combined craft
queues and persistent transaction matching are subsequent milestones.
