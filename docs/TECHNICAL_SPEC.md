# GW2 Craft Profit Tool – Technical Specification

## Purpose

This document defines the **technical implementation details** for the GW2 Craft Profit Tool.

It describes:

* database schema
* backend architecture
* API endpoints
* profit calculation algorithm
* data synchronization strategy

This document acts as the **engineering source of truth** during development.

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
| buy_quantity  | integer      | quantity at buy     |
| sell_price    | integer      | lowest sell listing |
| sell_quantity | integer      | quantity at sell    |
| last_updated  | timestamp    | last refresh time   |

---

## optional future tables

### owned_materials

Used for inventory-aware crafting.

```
owned_materials
```

| column  | type    |
| ------- | ------- |
| item_id | integer |
| count   | integer |

---

### price_history (future)

```
price_history
```

| column     | type      |
| ---------- | --------- |
| item_id    | integer   |
| buy_price  | integer   |
| sell_price | integer   |
| timestamp  | timestamp |

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

## Overview

The profit engine determines whether crafting an item is profitable.

It must recursively evaluate ingredient costs.

Example recipe tree:

```
Item A
 ├ Ingredient B
 │  ├ Ingredient D
 │  └ Ingredient E
 └ Ingredient C
```

---

## Trading Post Fees

Total fee:

```
15%
```

Formula:

```
net_sale = sell_price * 0.85
```

---

## Craft Cost Calculation

Ingredient cost is the minimum of:

```
min(
    trading_post_buy_price,
    craft_cost_of_ingredient
)
```

---

## Recursive Algorithm

Pseudo code:

```
calculate_craft_cost(item_id):

    if item_id has no recipe:
        return trading_post_buy_price

    recipe = recipe_for(item_id)

    total_cost = 0

    for ingredient in recipe.ingredients:

        buy_price = trading_post_buy_price(ingredient)

        craft_price = calculate_craft_cost(ingredient)

        ingredient_cost = min(buy_price, craft_price)

        total_cost += ingredient_cost * ingredient.count

    return total_cost
```

---

## Memoization

To prevent repeated calculations:

```
cache[item_id] = craft_cost
```

If item exists in cache:

```
return cached value
```

---

## Profit Calculation

For each recipe output:

```
craft_cost = calculate_craft_cost(item)
sell_price = trading_post_sell_price(item)

net_sale = sell_price * 0.85

profit = net_sale - craft_cost

roi = profit / craft_cost
```

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

The system should compute profitability in under:

```
1 second
```

after data has been cached.

---

# Future Extensions

Possible future enhancements:

* inventory-aware crafting
* trading post liquidity analysis
* historical price analysis
* crafting shopping lists
* desktop application packaging

---

# Definition of Implementation Ready

Development can begin when:

* database schema is finalized
* API endpoints are defined
* profit algorithm is agreed upon

This document provides sufficient detail to begin coding.