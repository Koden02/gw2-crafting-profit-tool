# GW2 Craft Profit Tool
![Python](https://img.shields.io/badge/python-3.11-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-backend-green)
![React](https://img.shields.io/badge/React-frontend-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

![Status](https://img.shields.io/badge/status-in%20development-orange) ![Version](https://img.shields.io/badge/version-0.1.0-blue)

⚠️ Project Status: Early Development (v0.1.0)

The backend data pipeline and profit calculation engine are implemented.
The frontend interface and additional analysis features are still in progress.

A local tool for analyzing **Guild Wars 2 crafting profitability** using live Trading Post data and recursive craft cost evaluation.

This project replicates and expands on the functionality of the now-defunct **gw2profits** website by calculating which items are profitable to craft and sell on the Trading Post.

The application runs **entirely locally**, using the official Guild Wars 2 API to retrieve game data and market prices.

---

# Features

Current MVP goals:

- Calculate profitable crafting opportunities
- Recursively evaluate crafting ingredient costs
- Compare craft cost vs Trading Post sale value
- Apply Trading Post fees automatically
- Display results in a sortable UI
- Show ingredient breakdown for any craftable item

Planned features:

- Inventory-aware crafting (using GW2 API keys)
- Trading Post liquidity analysis
- Historical price tracking
- Shopping list generation
- Docker distribution
- Desktop packaging

---

# How It Works

The application retrieves data from the official **Guild Wars 2 API**, caches it locally, and calculates crafting profitability.

Architecture overview:

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

The backend handles:

- API data synchronization
- caching game data locally
- crafting cost calculations
- profitability analysis

The frontend provides a user interface for browsing profitable crafts.

---

# Tech Stack

Backend

- Python
- FastAPI
- SQLite
- SQLAlchemy
- Pydantic

Frontend

- React
- TypeScript
- Vite
- Material UI or Tailwind

## Data Source

This application uses the official Guild Wars 2 API:

https://wiki.guildwars2.com/wiki/API:Main
---

# Project Structure

```

gw2-profit-tool
│
├ backend
│   ├ app
│   │   ├ api
│   │   ├ services
│   │   ├ models
│   │   ├ schemas
│   │   ├ db
│   │   └ main.py
│
├ frontend
│   ├ src
│   ├ components
│   ├ pages
│   └ api
│
├ docs
│   ├ PROJECT_PLAN.md
│   ├ TECHNICAL_SPEC.md
│   └ IMPLEMENTATION_ORDER.md
│
├ data
│
└ README.md

```

---

# Development Setup

## Requirements

- Python 3.11+
- Node.js 18+
- npm or yarn

---

# Backend Setup

Navigate to the backend folder:

```

cd backend

```

Create a virtual environment:

```

python -m venv venv

```

Activate the environment:

Linux / macOS

```

source venv/bin/activate

```

Windows

```

venv\Scripts\activate

```

Install dependencies:

```

pip install -r requirements.txt

```

Run the backend server:

```

uvicorn app.main:app --reload

```

Backend will start at:

```

[http://localhost:8000](http://localhost:8000)

```

API docs available at:

```

[http://localhost:8000/docs](http://localhost:8000/docs)

```

---

# Frontend Setup

Navigate to the frontend folder:

```

cd frontend

```

Install dependencies:

```

npm install

```

Run the development server:

```

npm run dev

```

Frontend will start at:

```

[http://localhost:5173](http://localhost:5173)

```

---

# Data Synchronization

The application caches GW2 API data locally.

Manual sync endpoints:

```

POST /api/sync/items
POST /api/sync/recipes
POST /api/sync/prices

```

Typical workflow:

1. Sync items and recipes once
2. Refresh prices periodically

---

# Profit Calculation

Profit is calculated using the formula:

```

net_sale = sell_price * 0.85
profit = net_sale - craft_cost
roi = profit / craft_cost

```

The system recursively evaluates crafting dependencies and chooses the cheapest option:

```

ingredient_cost = min(buy_price, craft_cost)

```

Memoization is used to avoid recalculating ingredient costs repeatedly.

---

# Documentation

Project documentation can be found in the `/docs` directory.

| File | Description |
|-----|-------------|
| PROJECT_PLAN.md | High-level project goals |
| TECHNICAL_SPEC.md | Database schema and algorithms |
| IMPLEMENTATION_ORDER.md | Step-by-step build order |

These documents serve as the **source of truth for the project architecture**.

---

# Development Roadmap

Phase 1  
Backend data pipeline

Phase 2  
Profit calculation engine

Phase 3  
Frontend profitable crafts interface

Phase 4  
UI improvements and stability

Phase 5  
Shareable distribution

Estimated timeline for MVP:

```

2–3 weeks

```

---

# Future Improvements

Possible future enhancements include:

- inventory-aware crafting
- Trading Post listing depth analysis
- historical price analysis
- profit stability scoring
- crafting shopping lists
- desktop application packaging

---

# Contributing

Contributions are welcome.

If you would like to contribute:

1. fork the repository
2. create a feature branch
3. submit a pull request

---

# Disclaimer

This project is not affiliated with or endorsed by ArenaNet.

Guild Wars 2 and all related assets are property of ArenaNet.

The application uses the official Guild Wars 2 public API.

---

# License

MIT License
