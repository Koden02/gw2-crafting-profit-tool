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
v0.1.0
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

## Trading Post Listings Analysis

Use listing depth data to estimate:

```
optimal batch size
liquidity risk
expected sale time
```

---

## Historical Price Tracking

Store periodic price snapshots to analyze:

```
price trends
market volatility
seasonal behavior
```

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