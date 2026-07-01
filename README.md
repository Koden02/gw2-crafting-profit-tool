# GW2 Craft Profit Tool

![Python](https://img.shields.io/badge/python-3.11-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-backend-green)
![React](https://img.shields.io/badge/React-frontend-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)
![Status](https://img.shields.io/badge/status-early%20development-orange)
![Version](https://img.shields.io/badge/version-0.1.6-blue)

GW2 Craft Profit Tool is a local full-stack app for analyzing Guild Wars 2 crafting profitability using the official Guild Wars 2 API, SQLite, recursive recipe costing, and Trading Post prices.

Project status: Early Development v0.1.6.

The v0.1.6 release is focused on local data sync, craft profitability analysis, pricing assumptions, Trading Post depth visibility, owned-material adjusted batch planning, and a usable frontend for browsing profitable crafts. Full inventory-aware table ranking, historical pricing, and packaging are planned future work.

## Implemented Features

- Backend data sync for items, recipes, and Trading Post commerce prices.
- SQLite cache for items, recipes, recipe ingredients, and commerce prices.
- Recursive craft-cost calculation.
- Trading Post fee handling.
- Profitable crafts endpoint with filters.
- Pricing strategy modes:
  - `material_pricing=buy`: value materials at buy-order prices.
  - `material_pricing=sell`: value materials at instant-buy prices.
  - `output_pricing=sell`: value crafted output at list-sell prices.
  - `output_pricing=buy`: value crafted output at instant-sell prices.
- Liquidity and suspicious spread filters.
- On-demand Trading Post listing-depth analysis:
  - break-even sale price
  - profitable instant-sell depth
  - competing profitable sell-listing quantity
  - market pressure label
- Craft vs sell ingredients comparison:
  - `ingredient_sale_value`
  - `crafted_item_value`
  - `value_add`
  - `recommendation`
- Scenario comparison for the four pricing mode combinations.
- React/MUI frontend with:
  - profitable crafts table
  - filtering
  - sorting
  - item name search over currently loaded rows
  - sync status visibility
  - frontend sync controls for items, recipes, and Trading Post prices
  - read-only account holdings sync for material storage and bank inventory
  - batch craft planner with missing-material shopping list
  - out-of-pocket batch profit and owned-material coverage in the planner
  - Trading Post market-depth view in the item detail drawer
  - summary cards
  - formatted coin values
  - recommendation chips
  - item detail drawer
  - ingredient breakdown

## Tech Stack

Backend:

- Python
- FastAPI
- SQLite
- SQLAlchemy
- pytest

Frontend:

- React
- TypeScript
- Vite
- Material UI

Data source:

- Official Guild Wars 2 API: https://wiki.guildwars2.com/wiki/API:Main

## Project Structure

```text
GW2_Profit/
  backend/
    app/
      api/
      db/
      models/
      services/
      main.py
    tests/
    requirements.txt
  data/
    gw2_profit.sqlite
  docs/
  frontend/
    src/
      api/
      pages/
      utils/
```

## Requirements

- Python 3.11+
- Node.js 18+
- npm

## Backend Setup

From the repository root:

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Run the backend:

```powershell
uvicorn app.main:app --reload
```

Backend URL:

```text
http://127.0.0.1:8000
```

API docs:

```text
http://127.0.0.1:8000/docs
```

## Frontend Setup

From the repository root:

```powershell
cd frontend
npm install
npm run dev
```

Frontend URL:

```text
http://127.0.0.1:5173
```

Vite may choose a later port if 5173 is already in use.

## Data Synchronization

The app caches Guild Wars 2 API data in `data/gw2_profit.sqlite`.

Recommended first sync order:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/sync/items
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/sync/recipes
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/sync/prices
```

After the first full sync, prices are the main dataset to refresh:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/sync/prices
```

Check local cache status:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/sync/status
```

## Profit Model

The core profit model is:

```text
net_sale = output_price - listing_fee - exchange_fee
profit = net_sale - craft_cost
roi = profit / craft_cost
```

Craft cost is recursive. For each ingredient, the engine chooses the cheaper available path between buying the ingredient and crafting the ingredient.

The craft vs sell ingredients comparison answers a separate question:

```text
value_add = crafted_item_value - ingredient_sale_value
```

Recommendation values:

- `Craft`: crafted output is worth more than selling the ingredients.
- `Sell Ingredients`: selling the ingredients is worth more than crafting the output.
- `Break Even`: both paths are equal under the selected pricing assumptions.

## Development Checks

Run backend tests:

```powershell
cd backend
venv\Scripts\python.exe -m pytest
```

Compile-check backend Python:

```powershell
cd backend
venv\Scripts\python.exe -m compileall app
```

Build frontend:

```powershell
cd frontend
npm run build
```

Lint frontend:

```powershell
cd frontend
npm run lint
```

## Current Limitations

Not implemented in v0.1.6:

- Full inventory-aware table ranking.
- Historical price charts.
- Price stability scoring.
- Docker or packaged desktop distribution.

## Documentation

Additional planning docs are in `docs/`:

- `PROJECT_PLAN.md`
- `TECHNICAL_SPEC.md`
- `IMPLEMENTATION_ORDER.md`

## Disclaimer

This project is not affiliated with or endorsed by ArenaNet.

Guild Wars 2 and related assets are property of ArenaNet.

The application uses the official Guild Wars 2 public API.

## License

MIT License.
