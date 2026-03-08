# GW2 Craft Profit Tool – Project Plan

## Overview

This project aims to create a **local application that analyzes Guild Wars 2 crafting recipes to determine profitable items to craft and sell on the Trading Post.**

The tool is inspired by the now-defunct **gw2profits** website and will replicate its core functionality while running locally on a user’s machine.

The application will:

* Retrieve item, recipe, and market data from the official Guild Wars 2 API
* Cache that data locally
* Calculate crafting costs recursively
* Compare costs against Trading Post sale values
* Display profitable crafting opportunities in a user-friendly interface

The system will be designed so that **other Guild Wars 2 players can download and run it locally**.

---

# Goals

Primary goals:

1. Replicate the core functionality of the old **gw2profits** tool
2. Provide a **fast and accurate profit calculator for crafting**
3. Run **locally without needing hosted infrastructure**
4. Provide a **clean and easy-to-use interface**
5. Keep the architecture simple and maintainable

Secondary goals:

* Allow optional use of GW2 API keys for inventory-aware calculations
* Provide historical market analysis
* Package the application so other players can run it easily

---

# Technology Stack

## Backend

Python will be used for backend services due to its strengths in:

* API integration
* data processing
* recursive algorithms
* rapid development

Technologies:

* **Python**
* **FastAPI**
* **SQLite**
* **SQLAlchemy**
* **Pydantic**

Responsibilities:

* Sync Guild Wars 2 API data
* Cache data locally
* Perform profitability calculations
* Serve data through REST API endpoints

---

## Frontend

The frontend will be built with modern web tools to provide an interactive interface.

Technologies:

* **React**
* **TypeScript**
* **Vite**
* **Material UI or Tailwind**

Responsibilities:

* Display profitable crafting items
* Provide filtering and sorting
* Show recipe ingredient breakdowns
* Allow user settings configuration

---

## Data Storage

A **local SQLite database** will be used for caching game data.

Advantages:

* No external dependencies
* Fast local queries
* Simple deployment
* Easy to back up or reset

---

# Architecture

The application will follow a **client-server architecture running locally**.

```
React Frontend
        │
        ▼
FastAPI Backend
        │
        ▼
SQLite Database
        │
        ▼
Guild Wars 2 API
```

### Data Flow

1. Backend syncs data from the GW2 API
2. Data is cached in SQLite
3. Profit engine calculates crafting profitability
4. Backend exposes results via API
5. React frontend displays results

---

# Guild Wars 2 API Endpoints

The following endpoints will be used.

### Static Data

Items

```
/v2/items
```

Recipes

```
/v2/recipes
```

Recipe details

```
/v2/recipes/{id}
```

### Market Data

Trading Post prices

```
/v2/commerce/prices
```

Trading Post listings (future feature)

```
/v2/commerce/listings
```

### Optional Account Data

Account materials

```
/v2/account/materials
```

Bank inventory

```
/v2/account/bank
```

Unlocked recipes

```
/v2/account/recipes
```

---

# Core Feature Set (MVP)

The Minimum Viable Product will support:

### Data Sync

* Fetch all items
* Fetch all recipes
* Fetch Trading Post prices
* Store data locally

### Profit Calculation

For each craftable item:

1. Calculate ingredient costs
2. Determine cheapest source for ingredients

   * buy from Trading Post
   * craft subcomponents
3. Calculate total crafting cost
4. Calculate net sale value after Trading Post fees
5. Determine profit and ROI

Trading Post fee model:

```
15% total fee
```

Example:

```
sell_price = 100g
net_sale = 85g
```

---

### Profitable Crafts Page

Display a list of craftable items with:

* item name
* crafting discipline
* crafting cost
* sale value
* profit
* ROI

The table will support:

* sorting
* filtering
* search

---

### Item Detail View

Selecting an item will display:

* recipe breakdown
* ingredient costs
* craft vs buy decision
* total crafting cost
* expected profit

---

# Profit Engine Design

The profit engine must support **recursive crafting dependencies**.

Example:

```
Item A
 ├ Ingredient B
 │  ├ Ingredient D
 │  └ Ingredient E
 └ Ingredient C
```

Each ingredient cost will be calculated as:

```
min(
    trading_post_buy_price,
    recursive_craft_cost
)
```

Memoization will be used to avoid recomputing ingredient costs repeatedly.

---

# Project Structure

```
gw2-profit-tool
│
├ frontend
│   ├ src
│   ├ components
│   ├ pages
│   └ api
│
├ backend
│   ├ app
│   │   ├ api
│   │   ├ services
│   │   ├ models
│   │   ├ db
│   │   └ main.py
│
├ docs
│   └ PROJECT_PLAN.md
│
├ data
│
└ README.md
```

---

# Development Phases

## Phase 1 – Backend Foundation

Tasks:

* create FastAPI project
* create SQLite schema
* implement GW2 API client
* sync item data
* sync recipe data
* sync trading post prices

Deliverable:

Backend capable of storing all necessary game data locally.

---

## Phase 2 – Profit Engine

Tasks:

* implement recursive crafting cost calculation
* implement craft-vs-buy logic
* calculate sale value after TP fees
* create profitable crafts endpoint

Deliverable:

API endpoint returning profitable crafting opportunities.

---

## Phase 3 – React MVP

Tasks:

* create React project
* build profitable crafts table
* add sorting and filtering
* connect frontend to backend API
* build item detail page

Deliverable:

Usable interface for exploring profitable crafts.

---

## Phase 4 – Polishing

Tasks:

* improve UI
* add loading states
* add refresh controls
* add settings page
* add Docker setup

Deliverable:

Stable version suitable for sharing with other players.

---

# Future Features

Potential future enhancements include:

Inventory-aware crafting

* detect materials owned by the player
* reduce crafting costs accordingly

Market analysis

* historical price tracking
* volatility analysis
* stable crafting opportunities

Trading Post liquidity analysis

* analyze listing depth
* avoid low-volume markets

Shopping lists

* show missing materials required for crafting

Desktop packaging

* package app using Tauri or Electron

---

# Estimated Development Timeline

Assuming part-time development:

Backend foundation

3–4 days

Profit engine

4–5 days

Frontend MVP

4–5 days

Polish and packaging

3–5 days

Estimated total:

```
2–3 weeks
```

for a strong working MVP.

---

# Key Risks

The main complexity areas include:

* recursive recipe evaluation
* non-trading-post ingredients
* recipe edge cases
* inaccurate profitability due to market fluctuations

These will be handled incrementally after the MVP is working.

---

# Definition of Done (MVP)

The project will be considered MVP complete when a user can:

1. Launch the application locally
2. View profitable crafting opportunities
3. Sort and filter the results
4. Inspect ingredient breakdown for any craftable item

At that point, the core goal of replicating **gw2profits functionality** will be achieved.