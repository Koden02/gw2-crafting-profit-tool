# Account crafting eligibility, reservations and reliable quotes

Implemented local milestones, September 2026. The existing SQLite, SQLAlchemy,
FastAPI and React architecture now supports selected-account eligible crafting
plans using bank/material storage, direct API capabilities and simple reservations.
Market estimates remain available without enforcing account eligibility.

## Updating an existing installation

1. Restart the backend. Startup runs the transactional, versioned SQLite migration.
2. Run **Sync Recipes** once and refresh prices. Older recipes are marked incomplete
   until refreshed because their cached ingredients may omit currency/guild costs.
3. Choose **Market estimates / Add account**, enter a key with `account`,
   `inventories`, `characters` and `unlocks` permissions, and **Sync Account Data**. The API verifies `/v2/account.id`.
4. Choose that account for subsequent refreshes and craft plans. The eligible-crafts
   filter starts enabled; expand **Character coverage and material reservations**
   to inspect sources or save stock for other goals. A key belonging to
   another account is rejected rather than silently switching or replacing data.

Old holdings are retained in `account_holdings_legacy_v0` and copied into an
unverified `legacy-owner-unknown` profile with zero allocatable stock. That profile
is visible but disabled in account selection. Its owner is never inferred from a
new key, quantities, a display name, or the most recently selected account. A fresh
identified sync creates usable stock without assigning the legacy snapshot.
Public items, recipes, prices, history, tracking settings and retention settings stay
shared. The migration does not rebuild those caches.

API keys are used for the requested sync and are not saved by the new UI or backend.
An old browser-stored key is ignored, not loaded or attributed to a profile. Watchlists
and saved filters now use separate browser storage keys per account. Old unscoped
preferences remain available only in market mode.

## Account snapshot contract

`AccountProfile` records the stable ID, display name, verified identity, snapshot ID,
source, observation time and source coverage. `AccountStack` records physical
source/position, item, quantity, binding and character binding. `AccountHolding`
contains account/item aggregates and a separate usable count.

`InventorySnapshot` is the adapter boundary for later import support. The current
adapter fetches and validates both bank and material storage before replacing only
the selected account's snapshot in one transaction. Failed, malformed, partial or
older bank/material refreshes preserve the previous snapshot. Writers serialize before comparing
snapshot times, so an older concurrent request cannot overwrite a newer result. Quote reads obtain the profile and holdings together so a refresh cannot mix stock with the wrong snapshot ID.
Source timestamps describe a collection interval; separate GW2 endpoints are not an
atomic view of an account while items are moving.

Only unbound bank/material stacks with usable public item definitions are allocated.
Shared inventory, character inventories and equipped items are not imported. Bound
stock is preserved but excluded from usable inventory. Crafting capabilities are a
separate part of the account snapshot and do not add inventory counts. Reservations
survive refreshes, subtract once before allocation and clamp available stock at zero.
A reservation can exceed present stock for a future goal; zero releases it.

Migration version 2 adds capability/reservation tables and a reservation revision to
existing profiles. Optimistic revision checks reject conflicting reservation saves
with HTTP 409. Quotes read capabilities, stock and reservations under a checked
(snapshot ID, reservation revision) pair, retrying boundedly if it changes.

## Crafting eligibility contract

The API adapter reads the character roster, each character's crafting ratings and
active disciplines, each character's usable recipe IDs, and account-wide recipe
unlocks. Every source records status and observation time. Missing/malformed/failed
capability reads preserve their last successful payload but invalidate that source
as proof, even if its timestamp is recent. A complete bank/material refresh can still
succeed when capability reads fail. Dropped characters disappear after a fresh roster
replacement. Keys are never included in stored error messages.

A source is fresh for one hour (with five minutes of future clock tolerance). Every
crafted root and intermediate must have an active qualified character and one of:

- `AutoLearned` metadata plus the required discipline/rating;
- a fresh account recipe unlock plus the required discipline/rating;
- a fresh character recipe list containing that recipe plus the required rating.

The resolver distinguishes automatic/known recipes, locked or undiscovered recipes,
insufficient levels, inactive disciplines, unsupported routes and unknown eligibility.
Missing or stale recipe lists never establish that a recipe is locked. One fresh,
qualified character can prove a route even if an unrelated character read failed.
An inactive discipline requires switching and is excluded because its cost is unpriced.
Each supported step names its crafter; different account characters may craft different
unbound/account-bound intermediates. Character-bound crafted intermediates are excluded.

Eligibility filters routes **before** local cost selection. A locked cheap recipe
cannot displace a known alternative. An ineligible intermediate may be bought when
that purchase has a valid quote; otherwise the root cannot be offered as eligible.
Known daily-limited outputs in `UNVERIFIED_DAILY_OUTPUTS` and `RefinementEctoplasm`
routes remain unknown/excluded because this milestone does not verify remaining
allowances. This explicit catalog needs maintenance when new time gates are added.
Vendor/currency/guild acquisition and unsupported recipe costs remain unavailable.

The character/source semantics follow the official wiki documentation for
[crafting](https://wiki.guildwars2.com/wiki/API:2/characters/:id/crafting),
[character recipes](https://wiki.guildwars2.com/wiki/API:2/characters/:id/recipes),
[recipe metadata](https://wiki.guildwars2.com/wiki/API:2/recipes), and
[daily resets](https://wiki.guildwars2.com/wiki/Server_reset).

## Quote contract

`CraftPlanner` is the common backend allocation service. It retains every recipe
variant, evaluates whole runs, shares one material/depth ledger across ingredients,
reuses intermediate surplus, and detects cyclic paths. Cyclic ingredients may still
be purchased if that purchase method has a valid quote. Missing/zero prices, empty
market sides, unsupported non-item ingredients and incomplete recipe data are not
zero-cost inputs.

The table chooses a supported root recipe for a target of one output, optionally
restricted to the requested discipline. Values in table/detail/scenarios are per
output of that recipe's whole batch; direct ingredient rows describe one recipe run.
The drawer passes the selected recipe ID through its detail, scenarios, output-depth
view and quantity plan, so these views cannot silently switch root recipes.
The plan API can omit `recipe_id` to evaluate all root variants for its target quantity.
Root overproduction is included in output sales; intermediate leftovers are listed
separately and receive no speculative profit credit.

All money is copper. `material_pricing=buy` means future buy orders;
`material_pricing=sell` means instant purchases from asks. `output_pricing=buy`
means selling into bids; `output_pricing=sell` means future listed sales.
`liquidation_pricing` defaults to the output mode and can be changed for owned stock.

For the requested plan:

| Value | Calculation |
| --- | --- |
| Purchase cost, B | Cost of missing materials through the selected acquisition routes |
| Net proceeds, R | Planned output sale proceeds after TP fees |
| Owned stock resale value, O | Net liquidation value of the actual owned stock consumed |
| Cash surplus | R - B |
| Gain versus selling owned stock | R - B - O |
| Upfront gold needed | B + output listing fees paid before sale |

Owned stock is never economically free. Output fees are already included in R and
are not deducted from profit a second time. A missing liquidation value makes economic
gain unknown even if cash surplus can be estimated. Table craft-versus-sell compares
output proceeds with the net liquidation of the actual acquired leaf materials,
using the same liquidation mode when account eligibility is disabled.

With the account filter enabled, table/detail/scenarios instead use the actual
reservation-adjusted plan: economic cost is B + O, profit/value added is R - B - O,
and owned resale value is O, all per output of the whole root batch. Eligible rows
require fresh holdings/prices and verified steps. The existing minimum-profit filter
then ranks by this economic gain. Output-depth analysis uses the selected output
mode for owned-stock liquidation too. Every table row is an independent plan; stock
is not shared across several rows. Enter quantity and budget in the drawer, then
check depth for that particular plan before acting.

The existing per-unit copper fee estimate is retained: floor 5% listing fee and floor
10% exchange fee, with a minimum of one copper for each. Actual transaction grouping
may change rounding. Quotes and copied plans disclose this approximation.

Allocation uses owned stock first, then deterministic local buy/craft choices scored
by purchases plus consumed stock's liquidation value. It is a bounded single-output
planner, not a global optimizer across batches, recipes, crafts or budgets. A budget
checks the entered quantity's upfront funding; it does not choose an optimal quantity.
Search is capped at 5,000 expansions and 40 nested item paths. Exhausted searches
produce an unavailable quote rather than claiming an optimum.

## Market confidence

**Refresh and check depth** walks current asks for instant material purchases and
bids for instant output sales and owned-material liquidation. Shared purchases are
aggregated before consuming book levels. Insufficient depth or network failures
produce unavailable/unknown totals without a top-price fallback. Depth reads are
bounded to 40 items, a 15-second start window and a five-second per-request timeout;
books are independent observations and may change during or after collection.

Buy orders and listed sales require future counterparties, so current listing counts
cannot validate their future fills. No quote promises sales volume or sale speed.
Cached quotes without a depth check are explicitly marked. Cached prices and holdings
older than one hour produce stale-data warnings. The UI invalidates account/quantity/
pricing-dependent plans and ignores superseded responses.

Existing output-only depth panels remain advisory and use fixed input unit costs;
their quantities are not recommended craft quantities. Snapshot flow labels describe
listing changes, not confirmed trades. Price-history charts and retention remain
unchanged by this milestone.

## API additions

- `GET /api/account/profiles`: selectable profiles and unverified legacy metadata.
- `POST /api/account/sync/holdings`: `api_key`, optional expected `account_id`,
  `include_crafting` (defaults true for API callers).
- `GET /api/account/holdings/status?account_id=...`: scoped status and snapshot ID.
- `GET /api/account/crafting?account_id=...`: source freshness and character coverage.
- `GET /api/account/materials?account_id=...`: owned/reserved material search.
- `PUT /api/account/reservations/{item_id}?account_id=...`: quantity, optional purpose,
  and `expected_revision`; conflicting writes return 409.
- `GET /api/profit/{item_id}/plan`: `quantity`, optional `account_id`, `recipe_id`,
  `budget`, material/output/liquidation modes, `check_depth` and `eligible_only`
  (defaults true when planning for an account).
- Profit/table/scenario reads accept account context; detail/scenario/output-depth
  reads accept `recipe_id`. `eligible_only=true` enables account allocation and
  eligibility in those comparisons; anonymous reads never allocate private stock.

`GW2_PROFIT_DATABASE` optionally selects an isolated SQLite file for tests/development.
`VITE_API_BASE_URL` optionally points the frontend at that backend.

## Acceptance and validation

The regression suite covers the prerequisite quote/migration contracts and:

| Acceptance criterion | Targeted tests |
| --- | --- |
| A/B/A use separate unlocks, stock, reservations and selected recipe | `test_recipe_selection_filters_before_choosing_cheapest`, `test_reservations_are_scoped_clamped_and_shared_across_steps`, existing account-switch tests |
| Unknown/stale/malformed coverage never proves eligibility; automatic and character-known routes work independently | `test_known_character_and_automatic_recipes_are_eligible`, `test_ineligible_states_are_distinct_and_not_quoted`, malformed/partial source tests |
| Every intermediate has a qualified crafter or a valid purchase route | `test_locked_intermediate_is_bought_and_known_intermediate_names_its_crafter`, daily-route test, existing cycle/unsupported-route tests |
| Table, detail, scenarios, depth cost and shopping quote reconcile under all four modes | `test_eligible_api_views_reconcile_account_costs_and_reservations` |
| Shared stock is consumed once after reservations, over-reservations clamp to zero, conflicting saves fail | shared-reservations and concurrent-private-read tests |
| Refreshes preserve reservations; v1/v2 and unknown-owner migrations are safe and repeatable | partial-capability refresh, v2 migration, existing legacy migration/rollback tests |

Run `python -m pytest tests -q -p no:cacheprovider` from `backend`, plus frontend
`npm run lint` and `npm run build`. **91 backend tests passed**; frontend lint and
production build passed. The browser smoke used a separate three-account fixture
database and mocked remote reads: account-specific recipe selection and crafter
names, reservation saves/recalculated purchases, A/B/C/A switching, inactive-character
exclusion, market preview, and reservation persistence after a full account refresh
all passed. SQLite datetime-adapter deprecations and the Vite
chunk-size warning remain known toolchain warnings. Isolated fixtures do not prove
real API credentials, current full-cache eligibility or live market fills. The real
account database is not migrated or refreshed by development tests.

## Remaining scope and next milestone

First validate the local upgrade with a recipe/price refresh and a real account data
sync. Then extend **inventory coverage through the common account-data model**:

1. Add shared/character inventory sources with location/binding-aware whole-source
   replacement. Never count equipped items or overlapping summaries twice.
2. Add the JSON adapter with explicit identity association and source freshness.
   Parity tests must show equivalent API/import inputs produce identical usable stock
   and capabilities, without merging duplicate physical stacks.
3. Only after coverage is trustworthy, add bounded quantity suggestions with budgets
   and both-sided depth. A multi-craft basket will need its own shared allocation.

The inspected Account JSON creator v3.1.1 and its real schema 3.0 export provide
location-aware inventory, binding and coverage information, but the sample omits a
stable account identifier and has a recipe count without recipe IDs. Import needs an
explicit account association and a representative `--include-recipes` export before
eligibility integration. Import is not implemented here. Do not trust the exporter's
derived `craftable_now` boolean as the eligibility authority.

Full cooldown allowances, bound-stock valuation, non-TP acquisition, globally optimal
recipes/quantities, packaging, UI redesign and new analytics remain outside this slice.
