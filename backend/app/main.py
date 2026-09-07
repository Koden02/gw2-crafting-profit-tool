from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.exc import OperationalError
from app.db.errors import is_database_busy
from app.services.reservation_service import AccountDataChanged

from app.api.account import router as account_router
from app.api.craft_recommendations import router as recommendations_router
from app.api.debug import router as debug_router
from app.api.price_history import router as price_history_router
from app.api.profitable_crafts import router as profitable_crafts_router
from app.api.profit import router as profit_router
from app.api.sync import router as sync_router
from app.db.init_db import init_db
from app.services.auto_sync_service import auto_price_sync_service


@asynccontextmanager
async def lifespan(app: FastAPI):
	init_db()
	auto_price_sync_service.start()

	try:
		yield
	finally:
		await auto_price_sync_service.stop()


app = FastAPI(
	title="GW2 Craft Profit Tool API",
	lifespan=lifespan,
)

app.add_middleware(
	CORSMiddleware,
	allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)


@app.get("/", include_in_schema=False)
def open_site() -> RedirectResponse:
	return RedirectResponse("http://127.0.0.1:5173/", status_code=307)


@app.get("/api/health")
def health_check() -> dict[str, str]:
	return {"status": "ok"}


@app.exception_handler(AccountDataChanged)
async def account_data_changed(request, exc):
	return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(OperationalError)
async def database_operational_error(request, exc):
	if not is_database_busy(exc):
		raise exc
	logging.getLogger(__name__).warning("SQLite busy: %s %s", request.method, request.url.path)
	return JSONResponse(
		status_code=503,
		headers={"Retry-After": "5"},
		content={"detail": "The local database is busy with another operation. Wait a moment and try again."},
	)


app.include_router(sync_router)
app.include_router(account_router)
app.include_router(recommendations_router)
app.include_router(debug_router)
app.include_router(profit_router)
app.include_router(profitable_crafts_router)
app.include_router(price_history_router)
