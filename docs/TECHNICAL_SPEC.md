# GW2 Craft Profit Tool – Technical Specification

## Purpose

This document defines the **technical implementation details** for the GW2 Craft Profit Tool.

It describes:

* database schema
* backend architecture
* API endpoints
* profit calculation algorithm
* data synchronization strategy

This document describes the base architecture. [Account quotes](ACCOUNT_QUOTES.md) defines the current account, migration, allocation and confidence contracts; it supersedes earlier inventory and recursion proposals.

---

# Backend Architecture

Backend stack:

* Python
* FastAPI
* SQLite
* SQLAlchemy
* Pydantic

Backend responsibilities:

* fetch data from GW2 API
* cache data locally
* calculate crafting profitability
* expose API endpoints to frontend

---

# Database Schema

SQLite will store cached game data.

## items

Stores static item metadata.

```
items
```

| column       | type         | description                  |
| ------------ | ------------ | ---------------------------- |
| id           | integer (PK) | GW2 item id                  |
| name         | text         | item name                    |
| type         | text         | weapon, armor, material, etc |
| rarity       | text         | rarity level                 |
| level        | integer      | item level                   |
| vendor_value | integer      | vendor value                 |
| flags        | text         | JSON array of item flags     |

---

## recipes

Stores recipe outputs.

```
recipes
```

| column            | type         | description       |
| ----------------- | ------------ | ----------------- |
| id                | integer (PK) | recipe id         |
| output_item_id    | integer      | produced item     |
| output_item_count | integer      | quantity produced |
| disciplines       | text         | JSON array        |
| min_rating | integer | Required crafting rating (not yet enforced) |
| flags | text | Recipe unlock flags |
| recipe_type | text | GW2 recipe type |
| ingredients_complete | boolean | False for legacy/unvalidated ingredient data |
| unsupported_reason | text | Non-item or guild input/output limitation |

---

## recipe_ingredients

Stores ingredients for recipes.

```
recipe_ingredients
```

| column    | type    | description       |
| --------- | ------- | ----------------- |
| recipe_id | integer | recipe reference  |
| item_id   | integer | ingredient item   |
| count     | integer | quantity required |

Primary key:

```
(recipe_id, item_id)
```

---

## commerce_prices

Stores trading post price snapshot.

```
commerce_prices
```

| column        | type         | description         |
| ------------- | ------------ | ------------------- |
| item_id       | integer (PK) | item id             |
| buy_price     | integer      | highest buy order   |
| buy_quantity  | integer      | total bid quantity     |
| sell_price    | integer      | lowest sell listing |
| sell_quantity | integer      | total ask quantity    |
| last_updated  | timestamp    | last refresh time   |

---

## account and history tables

`account_profiles` stores verified account identity, snapshot ID, source, timestamp
and coverage. `account_holdings` is keyed by `(account_id, item_id)` and includes raw
counts and allocatable counts. `account_stacks` is keyed by account/source/position
and preserves binding. Legacy holdings remain unassigned and excluded from plans.

Public `commerce_price_snapshots` and `commerce_price_rollups` implement shared local
history. `app_settings` and ignored/tracked-item configuration remain shared public
cache settings. `AccountCrafting` stores source-status/timestamped character ratings
and recipe IDs without duplicating stock; `MaterialReservation` stores account/item
quantities and optional purposes. A profile reservation revision guards concurrent
updates. Eligibility is enforced before buy/craft route selection in account mode.
See the models and [migration contract](ACCOUNT_QUOTES.md).

---

# Backend Services

The backend will be organized into service modules.

```
backend/app/services
```

### gw2_client.py

Responsible for:

* communicating with GW2 API
* batching API requests
* handling retries

Functions:

```
fetch_items()
fetch_recipes()
fetch_recipe(recipe_id)
fetch_prices()
fetch_listings()
```

---

### sync_service.py

Responsible for synchronizing API data into the database.

Functions:

```
sync_items()
sync_recipes()
sync_prices()
```

---

### profit_engine.py

Responsible for calculating crafting profitability.

Functions:

```
calculate_profit(item_id)
calculate_craft_cost(item_id)
calculate_profit_table()
```

---

# Profit Calculation Algorithm

`ProfitEngine` loads all recipe variants, market data and the explicitly selected
account's stock. `CraftPlanner` provides the common whole-quantity acquisition plan:

1. Select among supported recipes; keep the selected root recipe consistent across
   table/detail/scenario/plan views. Apply discipline filtering before selection.
2. Round each craft to whole runs, allocate from one shared stock ledger and reuse
   intermediate leftovers. Guard cycles and bound graph expansion.
3. Compare available purchase methods and crafting routes using the selected pricing
   mode. Missing prices or unsupported costs make routes unavailable.
4. Return purchases, consumed owned stock, ordered craft steps, leftovers and totals.

All prices use copper. The current fee estimate subtracts floor 5% listing and floor
10% exchange fees per output unit, with a minimum of one copper each. This is disclosed
as an estimate because actual transaction grouping can change rounding.

Table values are per output; plan values are whole-batch totals. `cash_surplus` is
net output proceeds minus new purchases. `economic_gain` also subtracts the net resale
value of consumed owned stock. Upfront funding separately includes output listing
fees, without deducting those fees twice from profit. Liquidation pricing defaults
to the output scenario. Unknown liquidation prices produce unknown comparisons.

The planner's deterministic local choices do not claim a global optimum. Buy orders
and sell listings require future fills. Instant depth checks walk both material asks
and output bids; the older output-only depth panel remains advisory. See
[exact contracts and limitations](ACCOUNT_QUOTES.md).

---

# API Endpoints

Base path:

```
/api
```

---

## profitable crafts

```
GET /api/profitable-crafts
```

Returns:

```
[
  {
    item_id
    name
    craft_cost
    sell_price
    net_sale
    profit
    roi
  }
]
```

Supports query parameters:

```
?min_profit=
?discipline=
?limit=
```

---

## item search

```
GET /api/items/search?q=
```

Returns matching items.

---

## recipe details

```
GET /api/recipe/{item_id}
```

Returns:

```
{
  item
  recipe
  ingredients
}
```

---

## profit details

```
GET /api/profit/{item_id}
```

Returns:

```
{
  craft_cost
  sell_price
  net_sale
  profit
  ingredient_breakdown
}
```

---

## data refresh

```
POST /api/sync/items
POST /api/sync/recipes
POST /api/sync/prices
```

These endpoints trigger database refresh.

---

# Sync Strategy

Different data has different refresh rates.

| Data    | Refresh Frequency   |
| ------- | ------------------- |
| Items   | once                |
| Recipes | once                |
| Prices  | every 10–15 minutes |

---

# Frontend API Usage

React will call the backend for:

```
/api/profitable-crafts
```

Used for main table.

```
/api/profit/{item_id}
```

Used for detail view.

---

# Data Processing Flow

```
GW2 API
   │
   ▼
Sync Service
   │
   ▼
SQLite Cache
   │
   ▼
Profit Engine
   │
   ▼
FastAPI Endpoints
   │
   ▼
React Frontend
```

---

# Development Milestones

## Milestone 1

Backend database + API sync.

Deliverable:

* items stored
* recipes stored
* prices stored

---

## Milestone 2

Profit engine operational.

Deliverable:

* profitable crafts endpoint working

---

## Milestone 3

Frontend table interface.

Deliverable:

* visible profitable craft list

---

## Milestone 4

Recipe breakdown page.

Deliverable:

* ingredient tree display

---

# Testing Strategy

Testing will include:

Unit tests

* profit calculation
* recursive crafting cost
* edge cases

Integration tests

* API endpoints
* database queries

Manual validation

* compare results against known profitable items

---

# Performance Considerations

Expected dataset size:

Items

~70k

Recipes

~10k

Trading post items

~15k

The original performance target was under:

```
1 second
```

after data has been cached. This is not yet achieved by the full graph scan. A temporary copy of the September 2026 cache (13,141 recipes, without history rows) loaded in about 2.9 seconds and scanned quotes in about 7.1 seconds. Live history aggregation and API latency add to that; this benchmark does not verify current market accuracy.

---

# Future Extensions

Possible future enhancements:

* JSON imports with explicit identity and source-coverage parity
* shared multi-craft allocation beyond the implemented [bounded batch suggestions](CRAFT_BATCHES.md)
* future analytics beyond existing depth/history/shopping features
* desktop application packaging

---

# Definition of Implementation Ready

Development can begin when:

* database schema is finalized
* API endpoints are defined
* profit algorithm is agreed upon

This document provides sufficient detail to begin coding.
