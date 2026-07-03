# GW2 Craft Profit Tool – Implementation Roadmap

## Purpose

This document defines the **development roadmap and current implementation status** of the GW2 Craft Profit Tool.

The goals are to:

* maintain a clear development structure
* prevent scope creep
* keep work focused on the MVP
* track remaining tasks
* guide future feature expansion

This file acts as the **source of truth for development priorities**.

---

# Guiding Principles

1. **Backend before frontend**
2. **Data pipeline before UI polish**
3. **Working features over perfect features**
4. **Avoid premature optimization**
5. **Avoid scope creep before MVP completion**
6. **Each layer must be validated before expanding**

---

# Current Architecture Overview

The application currently consists of three major layers.

### Data Layer

Handles all interaction with the GW2 API and local data storage.

Components:

* SQLite database
* SQLAlchemy models
* GW2 API client
* sync services

Stored data:

```
items
recipes
recipe_ingredients
commerce_prices
```

---

### Backend Layer

Provides business logic and API endpoints.

Components:

```
FastAPI application
profit engine
data sync endpoints
profit calculation endpoints
```

Main responsibilities:

* crafting cost calculation
* profit analysis
* bulk profitability scanning
* exposing data through API endpoints

---

### Frontend Layer

Provides the user interface.

Components:

```
React + TypeScript
MUI components
API client layer
```

Features currently implemented:

* profitable crafts table
* filtering controls
* sorting
* pricing strategy controls
* item detail drawer
* ingredient breakdown

---

# Implementation Status

## Phase 0 – Repository and Project Setup

Status: **Completed**

Completed work:

* repository created
* backend and frontend bootstrapped
* project structure defined
* documentation initialized
* README created
* gitignore configured

---

## Phase 1 – Backend Skeleton

Status: **Completed**

Completed work:

* FastAPI app created
* folder structure implemented
* database session handling
* health endpoint
* CORS configuration
* lifespan initialization

Endpoint:

```
GET /api/health
```

---

## Phase 2 – Database Schema

Status: **Completed**

Tables implemented:

```
items
recipes
recipe_ingredients
commerce_prices
```

These store all required MVP data.

---

## Phase 3 – GW2 API Client

Status: **Completed**

Implemented capabilities:

* fetch items
* fetch recipes
* fetch recipe details
* fetch commerce prices
* batch requests

---

## Phase 4 – Static Data Sync

Status: **Completed**

Implemented services:

```
sync_items()
sync_recipes()
```

Capabilities:

* item upserts
* recipe storage
* ingredient extraction
* relationship linking

---

## Phase 5 – Trading Post Price Sync

Status: **Completed**

Implemented service:

```
sync_prices()
```

Stored fields:

```
buy_price
buy_quantity
sell_price
sell_quantity
last_updated
```

---

## Phase 6 – Validation Endpoints

Status: **Completed**

Implemented endpoints for inspection:

```
GET /api/items/{item_id}
GET /api/recipes/{item_id}
GET /api/prices/{item_id}
```

These help validate the cached data.

---

## Phase 7 – Profit Engine

Status: **Completed**

Implemented features:

* recursive crafting cost calculation
* memoization cache
* ingredient breakdown
* trading post fee calculation
* ROI calculation
* liquidity detection
* suspicious spread detection

Pricing strategies supported:

```
material_pricing = buy | sell
output_pricing   = buy | sell
```

---

## Phase 8 – Bulk Profit Calculation

Status: **Completed**

Implemented capability:

```
calculate_profit_table()
```

Features:

* scans all craftable recipes
* calculates profitability
* filters invalid entries
* returns normalized result rows

---

## Phase 9 – Profit API Endpoints

Status: **Completed**

Core endpoints:

```
GET /api/profitable-crafts
GET /api/profit/{item_id}
GET /api/health
```

Optional debug endpoints also exist.

---

## Phase 10 – Frontend Skeleton

Status: **Completed**

Implemented:

* React application
* TypeScript types
* API integration layer
* base layout
* page structure

---

## Phase 11 – Profitable Crafts Table

Status: **Completed**

Implemented features:

* profit table
* filtering controls
* sorting
* ROI calculation display
* liquidity filters
* pricing strategy controls

---

## Phase 12 – Item Detail View

Status: **Completed**

Implemented:

* row click opens detail drawer
* ingredient breakdown
* pricing source explanation
* formatted coin display

---

# Remaining MVP Work

The following tasks remain before the application can be considered a **complete MVP**.

---

# Phase A – Craft vs Sell Ingredient Comparison

Goal:

Determine whether crafting adds value compared to selling ingredients directly.

Required calculations:

```
ingredient_sale_value
crafted_item_net_value
value_added_by_crafting
crafting_beats_selling_ingredients
```

Backend should return:

```
value_add
ingredient_sale_net
recommendation
```

Possible recommendation values:

```
Craft
Sell Ingredients
Break Even
```

---

# Phase B – Search Functionality

Goal:

Allow users to find specific items quickly.

Implementation options:

Frontend search filtering

Optional backend endpoint:

```
GET /api/items/search?q=
```

Search fields:

```
item name
partial name
```

---

# Phase C – UI Usability Improvements

Planned improvements:

* highlight selected row
* alternating row colors
* show pricing strategy in detail view
* profit color coding
* coin icons
* improved loading states
* improved empty states

---

# Phase D – Sync Visibility

Goal:

Show when market data was last refreshed.

Possible UI additions:

```
last price sync timestamp
manual refresh button
```

Optional backend endpoint:

```
GET /api/sync/status
```

---

# Phase E – Basic Automated Tests

Backend tests should cover:

```
craft cost calculation
recursion behavior
pricing strategy logic
liquidity filters
craft vs ingredient comparison
```

API tests should cover:

```
profitable crafts endpoint
profit detail endpoint
```

---

# Phase F – MVP Release Preparation

Tasks:

* improve README setup instructions
* document data sync process
* optional Docker setup
* remove unnecessary debug endpoints
* create version tag

```
v0.1.12
```

Exit criteria:

A developer can clone the repo and run the application easily.

---

# Post-MVP Roadmap

These features will be implemented **after MVP completion**.

---

## Inventory-Aware Crafting

Use GW2 account API keys to analyze owned materials.

Capabilities:

```
owned materials
missing materials
shopping list
true profit calculation
```

---

## v0.2 - Trading Post Order-Book Depth and Sell-Limit Analysis

Goal:

Determine how many units of a crafted item can realistically be sold before the market price drops below break-even.

This feature should use the GW2 API listings endpoint:

```
/v2/commerce/listings
```

This is separate from the existing top-level Trading Post price sync from:

```
/v2/commerce/prices
```

The existing price data remains useful for quick table scans. Listing depth data should be used when the app needs order-book analysis for selected crafted items.

### Commerce Listings Sync

Required work:

* add GW2 API client support for `/v2/commerce/listings`
* store or fetch order-book depth data for selected items
* track buy order levels
* track sell listing levels

Each order-book level should include:

```
price
quantity
```

Possible implementation options:

* fetch listings on demand for item detail analysis
* cache listings for recently inspected items
* later add a dedicated listings sync table if bulk depth scanning becomes necessary

---

### Instant-Sell Profit Depth

Goal:

Calculate how many crafted items can be instant-sold into buy orders before profit reaches zero.

Buy order levels should be processed from highest price to lowest price.

For each buy order level:

```
net_sale = trading_post_net(buy_order_price)
profit_per_item = net_sale - craft_cost
```

Continue consuming order quantities while:

```
profit_per_item > 0
```

Stop when the next buy order level is break-even or unprofitable.

Return fields:

```
break_even_sale_price
last_profitable_buy_order_price
instant_sell_limit_quantity
instant_sell_depth_profit
profitable_buy_order_levels
```

Notes:

* `break_even_sale_price` is the minimum gross sale price needed after Trading Post fees to cover craft cost
* `instant_sell_limit_quantity` is the total buy-order quantity that remains profitable
* `instant_sell_depth_profit` is the total expected profit if all profitable buy-order depth is consumed

---

### List-Sell Competition Depth

Goal:

Estimate how much existing sell-side competition exists before list-sell pricing reaches an unprofitable price.

Sell listing levels should be processed from lowest price to highest price.

The analysis should compare each sell listing level against the crafted item's break-even price after Trading Post fees.

Return fields:

```
profitable_listing_price_floor
existing_competing_sell_quantity
competing_sell_levels
estimated_market_pressure
```

Possible `estimated_market_pressure` labels:

```
thin market
healthy market
dead market
```

Notes:

* `profitable_listing_price_floor` is the lowest list-sell price that remains profitable after fees
* `existing_competing_sell_quantity` is the current sell-side quantity competing at profitable prices
* `competing_sell_levels` should preserve price and quantity for each relevant sell listing level
* `estimated_market_pressure` should be a simple user-facing warning, not a velocity claim

---

### UI Display Ideas

Possible table additions:

* sell limit column
* depth profit column
* break-even price column
* market depth warning column

Possible detail drawer additions:

* order-book section
* profitable buy-order levels
* competing sell listing levels
* break-even sale price
* market depth label

Market depth labels can start simple:

```
thin market
healthy market
dead market
```

---

### Deferred: Historical Velocity

True market velocity requires historical snapshots.

This should remain a later `v0.3+` feature because it requires storing repeated order-book or price snapshots over time.

Do not treat current listing depth as proof that items will sell quickly. The v0.2 feature should estimate current depth and competition only.

---

## Historical Price Tracking

Store periodic price snapshots to analyze:

```
price trends
market volatility
seasonal behavior
```

v0.2.0 completed the first read-only history slice:

* per-item price history API
* automatic raw, hourly, or daily resolution selection
* item detail drawer chart for local buy and sell price history
* table-level local history availability indicator
* empty-history sync action and rollup min/max chart markers

Remaining work:

* trend scoring
* price stability scoring
* historical order-book velocity

---

## Advanced Crafting Tools

Potential future features:

```
shopping list generation
recursive ingredient tree UI
crafting chains
profit graphs
analytics views
```

---

# Immediate Next Development Task

The next task to implement is:

**Craft vs Sell Ingredient Comparison**

This feature ensures the tool correctly identifies when crafting adds value versus simply selling the materials.

---
