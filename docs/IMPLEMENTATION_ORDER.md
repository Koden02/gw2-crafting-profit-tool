# GW2 Craft Profit Tool – Implementation Order

## Purpose

This document defines the recommended build order for the GW2 Craft Profit Tool.

The goal is to:

* reduce context switching
* avoid premature polish
* keep development focused
* ensure every step builds on the previous one

This is the task-order source of truth during implementation.

---

# Guiding Principles

1. Build the backend before the frontend.
2. Make the data pipeline work before making the UI pretty.
3. Prefer an ugly working feature over a polished incomplete one.
4. Avoid scope creep until the MVP is functional.
5. Validate each layer before moving to the next.

---

# MVP Build Strategy

The project will be built in this order:

1. Project setup
2. Database setup
3. GW2 API client
4. Data sync
5. Profit engine
6. Backend endpoints
7. Frontend MVP
8. Polish
9. Packaging / sharing

---

# Phase 0 – Repository and Project Setup

## Goal

Create the repo and baseline structure so development can proceed cleanly.

## Tasks

* create project repository
* create top-level folders:

  * `frontend/`
  * `backend/`
  * `docs/`
  * `data/`
* add planning documents:

  * `PROJECT_PLAN.md`
  * `TECHNICAL_SPEC.md`
  * `IMPLEMENTATION_ORDER.md`
* create README with basic project description
* initialize backend Python environment
* initialize frontend React + TypeScript app
* add `.gitignore`

## Deliverable

A clean repo structure with frontend and backend bootstrapped.

## Exit Criteria

* repo exists
* backend starts
* frontend starts
* docs are committed

---

# Phase 1 – Backend Skeleton

## Goal

Create the backend app structure before adding any real logic.

## Tasks

* create FastAPI app entry point
* define app folders:

  * `api/`
  * `services/`
  * `models/`
  * `schemas/`
  * `db/`
* add config handling
* add DB session setup
* add health-check endpoint

Suggested first endpoint:

`GET /api/health`

Response example:

```json
{ "status": "ok" }
```

## Deliverable

A running backend with a clean structure.

## Exit Criteria

* FastAPI app launches locally
* `/api/health` responds successfully
* DB connection setup exists

---

# Phase 2 – Database Schema

## Goal

Create the local SQLite schema used by the application.

## Tasks

* define SQLAlchemy models for:

  * `items`
  * `recipes`
  * `recipe_ingredients`
  * `commerce_prices`
* create DB initialization script
* verify tables are created correctly
* add simple local DB file path configuration

## Deliverable

A working SQLite schema matching the technical spec.

## Exit Criteria

* DB file is created
* all MVP tables exist
* backend can open a DB session without errors

---

# Phase 3 – GW2 API Client

## Goal

Create the service responsible for talking to the Guild Wars 2 API.

## Tasks

* build a reusable GW2 API client module
* add methods for:

  * fetching items
  * fetching recipes
  * fetching recipe details
  * fetching commerce prices
* add batching support where needed
* add retry/error handling
* log request failures clearly

## Notes

Keep this layer focused only on remote API communication.
Do not mix DB writes into the client.

## Deliverable

A service that can successfully pull raw data from the GW2 API.

## Exit Criteria

* can fetch item data
* can fetch recipe data
* can fetch price data
* errors are handled cleanly enough for local development

---

# Phase 4 – Static Data Sync

## Goal

Load static GW2 data into SQLite.

## Tasks

* implement `sync_items()`
* implement `sync_recipes()`
* implement recipe ingredient storage
* handle inserts/upserts
* verify row counts after sync
* create manual trigger endpoints or scripts

Suggested endpoints:

* `POST /api/sync/items`
* `POST /api/sync/recipes`

## Deliverable

Local DB contains item and recipe data.

## Exit Criteria

* items are stored locally
* recipes are stored locally
* recipe ingredients are linked correctly
* you can query a recipe and see its ingredients

---

# Phase 5 – Trading Post Price Sync

## Goal

Load market data into SQLite.

## Tasks

* implement `sync_prices()`
* store:

  * buy price
  * buy quantity
  * sell price
  * sell quantity
  * last updated timestamp
* create manual refresh endpoint

Suggested endpoint:

* `POST /api/sync/prices`

## Deliverable

Current TP prices are cached locally.

## Exit Criteria

* price rows exist in DB
* refresh updates timestamps
* known TP items show expected values

---

# Phase 6 – Read-Only Validation Endpoints

## Goal

Make it easy to inspect cached data before writing the profit engine.

## Tasks

Add temporary or permanent endpoints such as:

* `GET /api/items/{item_id}`
* `GET /api/recipes/{item_id}`
* `GET /api/prices/{item_id}`

These help verify:

* item exists
* recipe exists
* prices exist
* relationships look correct

## Deliverable

Basic inspection endpoints for debugging and validation.

## Exit Criteria

* you can manually verify several items from cached data
* recipe ingredients display correctly
* prices can be retrieved for a known item

---

# Phase 7 – Profit Engine v1

## Goal

Create the first working profitability calculator.

## Scope

Start simple.

Version 1 should:

* calculate craft cost
* use TP price when no recipe exists
* calculate sell revenue after fees
* calculate profit
* calculate ROI

## Tasks

* implement `calculate_craft_cost(item_id)`
* implement `calculate_profit(item_id)`
* implement memoization cache
* handle recipe lookup
* handle ingredient lookup
* apply 15% TP fee
* return structured output

## Important Rule

Do not solve every edge case yet.

For MVP v1:

* skip items with missing prices
* skip items with unpriceable ingredients
* skip weird unsupported cases cleanly

## Deliverable

A backend service that can calculate profit for a single item.

## Exit Criteria

* known items can be evaluated successfully
* ingredient breakdown is understandable
* repeated calculations do not feel wasteful

---

# Phase 8 – Profit Engine v2: Bulk Calculation

## Goal

Calculate profitability across many craftable items.

## Tasks

* implement `calculate_profit_table()`
* iterate across recipe outputs
* exclude invalid or unsupported items
* produce a normalized result row for each valid craft
* sort by profit descending by default

Suggested result fields:

* item_id
* name
* discipline
* craft_cost
* sell_price
* net_sale
* profit
* roi

## Deliverable

A service that returns a full profitable-crafts list.

## Exit Criteria

* multiple craftable items are returned
* rows look correct
* output can be sorted and filtered later

---

# Phase 9 – Core Profit API Endpoints

## Goal

Expose the profit engine through stable API endpoints.

## Tasks

Create endpoints:

* `GET /api/profitable-crafts`
* `GET /api/profit/{item_id}`
* `GET /api/recipe/{item_id}`
* `GET /api/items/search?q=`

Add basic query params for:

* min profit
* discipline
* limit
* search

## Deliverable

Frontend-ready API endpoints.

## Exit Criteria

* endpoints return JSON successfully
* profitable crafts endpoint is usable from browser/Postman
* single-item profit endpoint shows breakdown data

---

# Phase 10 – Frontend Skeleton

## Goal

Prepare the React app structure before real UI work begins.

## Tasks

* create frontend folder structure:

  * `components/`
  * `pages/`
  * `api/`
  * `types/`
* create API client wrapper
* create base layout
* add routing
* create placeholder pages:

  * profitable crafts page
  * item detail page
  * settings page placeholder

## Deliverable

React app with navigation and API plumbing.

## Exit Criteria

* app runs locally
* routes work
* frontend can call backend

---

# Phase 11 – Profitable Crafts Table

## Goal

Build the main value screen of the application.

## Tasks

* fetch `/api/profitable-crafts`
* display rows in a table
* add columns for:

  * item name
  * discipline
  * craft cost
  * sell value
  * profit
  * ROI
* add client-side or server-side sorting
* add search/filter controls
* add loading and error states

## Deliverable

Usable profitable crafts screen.

## Exit Criteria

* list displays correctly
* sort works
* search/filter works
* user can identify profitable items quickly

---

# Phase 12 – Item Detail View

## Goal

Allow users to inspect why an item is profitable.

## Tasks

* build detail page or side panel
* fetch `/api/profit/{item_id}`
* show:

  * total craft cost
  * sell price
  * net sale
  * profit
  * ingredient breakdown
* show craft-vs-buy decisions where possible
* link table rows to detail view

## Deliverable

Item breakdown screen that explains the calculation.

## Exit Criteria

* clicking an item opens useful details
* ingredient list is readable
* math is understandable to the user

---

# Phase 13 – MVP Cleanup Pass

## Goal

Make the app stable and pleasant enough to use regularly.

## Tasks

* improve error handling
* improve loading states
* add last-sync timestamps
* add manual refresh buttons
* clean up rough UI edges
* remove temporary debug endpoints if not needed
* verify empty-state behavior

## Deliverable

A clean local MVP.

## Exit Criteria

* app feels stable
* common errors are understandable
* refresh flow works
* no major confusion points remain

---

# Phase 14 – Testing Pass

## Goal

Reduce regressions and validate correctness.

## Tasks

Backend tests:

* craft cost calculation
* memoization behavior
* fee calculation
* unsupported-case handling

API tests:

* profitable crafts endpoint
* single profit endpoint
* recipe endpoint

Frontend checks:

* table rendering
* detail page loading
* search/filter behavior

Manual validation:

* compare a few outputs against known recipes
* verify fee math
* verify ingredient totals

## Deliverable

Basic confidence in correctness.

## Exit Criteria

* critical logic is tested
* manual spot checks pass
* app is safe to iterate on

---

# Phase 15 – Shareability Improvements

## Goal

Prepare the app for other users.

## Tasks

* improve README setup instructions
* add one-command startup if possible
* add environment/config examples
* optionally add Docker support
* document refresh process
* document GW2 API key future support if planned

## Deliverable

Project is easier for others to run.

## Exit Criteria

* a technical user can clone and run it without guesswork
* setup steps are documented clearly

---

# Post-MVP Feature Order

Once MVP is complete, features should be added in this order:

1. Inventory-aware crafting
2. Better unsupported-ingredient handling
3. Trading Post listing depth / liquidity checks
4. Historical price tracking
5. Pandas-powered analytics views
6. Shopping list generation
7. Desktop packaging

This order keeps value high while complexity grows gradually.

---

# What Not To Do Early

Avoid these until MVP is working:

* desktop packaging
* user auth
* cloud hosting
* advanced charts
* price history analysis
* perfect styling
* cooldown optimization
* exotic edge-case support

These are all valid later, but they should not block the main calculator.

---

# Recommended Weekly Cadence

A realistic part-time pace:

## Week 1

* setup
* DB
* API client
* item/recipe/price sync

## Week 2

* profit engine
* endpoints
* first table UI

## Week 3

* detail page
* cleanup
* testing
* shareability improvements

That should produce a real MVP.

---

# Immediate Next Task

The first implementation task is:

**Create the repository structure and bootstrap the backend and frontend projects.**

That means:

* repo
* docs
* FastAPI app
* React app
* SQLite setup scaffold

Once that is done, move directly to database schema implementation.