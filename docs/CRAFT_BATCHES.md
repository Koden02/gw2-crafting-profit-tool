# Budgeted crafting batches

Implemented on `codex/inventory-coverage`, September 2026. This milestone connects
account inventory and crafting access to a practical single-craft workflow. It uses
the existing [account and quote contracts](ACCOUNT_QUOTES.md).

## Using the workflow

1. Refresh recipes if the cache predates eligibility support, then refresh prices.
   Choose an account and **Sync Account Data** with `account`, `inventories`,
   `characters` and `unlocks` permissions. Check inventory and character coverage.
2. In **Find a profitable crafting batch**, enter a gold budget, minimum total gain,
   and maximum output count. **Find batches** checks current instant-buy material
   offers and instant-sell output offers for a bounded shortlist.
3. Compare expected gain, upfront gold and material purchases. Each result is an
   independent use of the same stock and budget; results are not a combined basket.
4. **Review and refresh plan** obtains a new quote for the suggested recipe and
   quantity. Review any changed totals or budget/depth warnings, then use or copy
   its gathering locations, purchases and named crafting steps.
   The **gw2efficiency**, **GW2TP** and **Wiki** links open additional information in
   a new tab. Calculator links use the quoted whole output quantity when available,
   or the current target while a quote is loading. Shopping ingredients also have
   **Market** links. External pages use their own prices and account settings;
   local reservations and selected recipe routes do not transfer.
5. After crafting and selling the entire output, expand **Record the result after
   crafting and selling**. Enter total material purchases and net sales after both
   Trading Post fees, including the upfront listing fee. Partial or unsold batches
   should wait. The account's **Completed craft results** compares actual cash
   surplus and gain using quoted stock value with the estimate.
6. Sync account data after crafting before requesting another batch. The manual
   result log does not modify the backend inventory snapshot or reservations.

Results are saved only in this browser, separately per account, retaining the
latest 50 entries. Reloading retains records; select the same account again to view
them. Clearing browser storage removes them. API keys are never stored in this log.
The comparison retains the quote's valuation of consumed owned stock; it does not
reconstruct historical market values or automatically import actual transactions.

## Inventory contract

A full sync reads bank, material storage, shared inventory, the current character
roster and each character's bag inventory before writing the selected account's
snapshot. Any malformed or failed required inventory read preserves the previous
snapshot. Fresh empty sources clear their old stock, moved items replace physical
positions, and deleted characters disappear after a fresh roster replacement.
The material API may repeat one item under different catalog categories. Matching
item balances and binding metadata are counted once; conflicting repeated rows
reject the refresh and preserve the previous snapshot. Separate bank/shared/bag
slots remain separate physical stacks even when their item IDs match.

Stored sources retain their own observation times. A legacy bank/material-only
refresh preserves untouched sources and their original freshness. Batch suggestions
require every inventory source, including every current character, to be fresh for
one hour with five minutes of future clock tolerance. Crafting access independently
requires a fresh qualified character for each crafted step. Missing capability reads
do not establish access.

Only usable unbound stacks contribute to allocation. Binding and character binding
are retained but excluded from usable counts. Bag containers, equipped items and
embedded upgrades are not counted again. Reservations survive refresh and subtract
once from aggregate usable stock. Gather instructions identify bank/shared slots,
material storage, and character bag/slot positions; positions are displayed starting
at one. Source reads are an observation interval, not an atomic game-side snapshot.

This adapter follows the official API documentation for
[shared inventory](https://wiki.guildwars2.com/wiki/API:2/account/inventory) and
[character inventories](https://wiki.guildwars2.com/wiki/API:2/characters/:id/inventory).
Migration v3 adds `shared_count` and `character_count` to holdings. Existing public
caches, holdings and reservations remain intact. Backups belong locally outside Git;
`data/backups/`, SQLite files and sidecars are ignored.

## Search and pricing contract

`POST /api/craft-recommendations` accepts:

| Field | Meaning |
| --- | --- |
| `account_id` | Explicit verified account; required |
| `budget` | Positive upfront funding limit in copper, at most 100,000,000 |
| `minimum_gain` | Minimum total economic gain in copper; default 1,000, same upper bound |
| `max_output` | Maximum total output count, 1–200; default 100 |

The endpoint returns at most five independent suggestions.

The service screens supported, eligible first batches using fresh cached prices,
ranks candidates by estimated gain per output, and checks at most 12 recipe
candidates with live books. A nonpositive first-batch estimate does not by itself
exclude larger batches. Cached screening can omit better crafts, and the service
discloses when the shortlist or execution bounds truncate the search.

For each checked recipe it evaluates every whole root batch within the output cap.
It selects the highest total economic gain that satisfies the budget and minimum
gain, then prefers lower upfront funding and smaller output counts on ties. It does
not assume that cost or gain changes monotonically with quantity: nested whole
batches, owned stock and alternative routes can change the best choice. The existing
planner makes bounded local acquisition choices; this is not a global optimizer.

Every returned quote uses live asks for purchases and live bids for both output
sales and consumed-stock liquidation. Books are reused across quantity trials in
one search, including failed lookups. Missing, malformed, failed or insufficient
books invalidate affected quotes without a cached top-price fallback. The search
allows at most 80 item-book attempts and starts no further work after 35 seconds;
an in-flight HTTP call can take up to its five-second timeout. Existing per-plan
40-book, expansion and path bounds still apply. Response counters, issue messages,
and observation timestamps explain the completed scope.

The quote uses the existing per-unit estimate for the 5% listing and 10% exchange
fees, with minimum-copper rounding. Transaction grouping may change actual rounding.
The [Trading Post rules](https://wiki.guildwars2.com/wiki/Trading_post) apply both
fees to instant sales too. The figures are:

| Figure | Calculation |
| --- | --- |
| Upfront gold | Material purchases + output listing fees |
| Cash surplus | Net sales after both fees − material purchases |
| Economic gain | Cash surplus − net resale value of consumed owned stock |

Individual book reads are independent observations; orders can change before a
purchase or sale. Suggestions and quantity-limit explanations describe tested
plans, not guaranteed fills, sale speed or realized profit. A snapshot/reservation
revision change during the request rejects the result with HTTP 409. Account,
reservation, sync and search-input changes invalidate dependent UI results.

## Validation and remaining checks

The full backend suite passes 122 tests, including new coverage for source movement,
empty/deleted characters, binding, account isolation, partial refresh freshness,
failed reads, migration v3, depth failures, reservations, whole-output caps,
nonmonotonic quantity selection, budget/fee arithmetic, duplicate material categories,
conflicting repeated balances, search limits and concurrent
account changes. Frontend production build and lint pass. Known SQLite datetime
deprecations and the existing Vite chunk-size warning remain.

An isolated development database and mocked GW2 responses validate the browser
workflow from account selection through suggested quantity, refreshed purchases,
gathering locations, local actual-result recording, reload persistence and A/B/A
account isolation. Saving a reservation removes the prior suggestion and recalculates
its quantity; editing the budget also clears the prior result. A read-only full-cache
check loaded 72,853 items and 13,183 recipes, then completed 1,200 quantity checks in
11.69 seconds using synthetic account access and cached prices as simulated books.
That check exercised the book bound and returned five suggestions; it does not
measure remote API latency or validate those suggestions against live offers.

The main local backend successfully applied migration v3. Item, recipe, ingredient,
price, profile, holding, stack and reservation counts were unchanged, including all
750 unknown-owner holdings with zero usable stock. The existing backup remained
local and ignored by Git, and automatic price sync was restored afterward.

Fixture validation does not establish real API credentials or successful live
market fills. A subsequent user-triggered sync verified one real account, with fresh
inventory and crafting/recipe coverage for all 16 characters, bank, materials and
shared slots. Account holdings contained 1,415 item types, and per-source totals
reconciled without aggregate mismatches. Legacy holdings remained separate and
unallocatable. Automatic price sync was enabled and reported no error.

The first user-triggered live sync reported `Duplicate location in materials` before
writing a verified profile. The public material catalog was found to repeat item
97105 in categories 5 and 49. The importer now accepts matching repeated balances
without adding them twice; five regression cases cover matching and conflicting
rows. After the user restarted the backend, authenticated sync succeeded. The
previously repeated material occupied one physical material-storage row. The live
batch finder then returned five suggestions using a 10-gold budget, 0.1-gold minimum
gain and ten-output cap. It completed eight recipe candidates and 71 quantities
before the time limit; the UI disclosed the limited scope. A small actual craft and
sale, followed by recorded realized totals, remain pending. Opening and refreshing
the leading four-output plan verified its eligibility and live depth again; purchase
cost, upfront funding, owned-stock valuation and economic gain matched the search
result, and the UI displayed its shopping list and named crafting step.

JSON import, full cooldown allowances, bound-stock valuation, non-TP acquisition,
multi-craft shared budgets and automatic transaction reconciliation remain outside
this milestone.
