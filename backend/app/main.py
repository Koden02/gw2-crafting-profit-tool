from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.debug import router as debug_router
from app.api.profitable_crafts import router as profitable_crafts_router
from app.api.profit import router as profit_router
from app.api.sync import router as sync_router
from app.db.init_db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
	init_db()
	yield


app = FastAPI(
	title="GW2 Craft Profit Tool API",
	lifespan=lifespan,
)


@app.get("/api/health")
def health_check() -> dict[str, str]:
	return {"status": "ok"}


app.include_router(sync_router)
app.include_router(debug_router)
app.include_router(profit_router)
app.include_router(profitable_crafts_router)