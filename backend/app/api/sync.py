from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.models.commerce_price import CommercePrice
from app.models.item import Item
from app.models.recipe import Recipe
from app.services.auto_sync_service import auto_price_sync_service
from app.services.price_history_service import PriceHistoryService
from app.services.sync_service import SyncService

router = APIRouter(prefix="/api/sync", tags=["sync"])


class PriceHistoryConfigUpdate(BaseModel):
	auto_price_sync_enabled: bool | None = None
	price_sync_interval_minutes: int | None = Field(default=None, ge=2, le=1440)
	raw_snapshot_retention_days: int | None = Field(default=None, ge=1, le=365)
	hourly_rollup_retention_days: int | None = Field(default=None, ge=1, le=1825)
	daily_rollup_retention_days: int | None = Field(default=None, ge=1, le=3650)
	max_history_mb: int | None = Field(default=None, ge=128, le=1024 * 1024)
	snapshot_item_mode: Literal["relevant", "all"] | None = None


class IgnorePriceItemRequest(BaseModel):
	reason: str | None = None


@router.post("/items")
def sync_items(db: Session = Depends(get_db)) -> dict[str, int | str]:
	service = SyncService(db)
	count = service.sync_items()
	return {"status": "ok", "items_upserted": count}


@router.post("/recipes")
def sync_recipes(db: Session = Depends(get_db)) -> dict[str, int | str]:
	service = SyncService(db)
	count = service.sync_recipes()
	return {"status": "ok", "recipes_upserted": count}

@router.post("/prices")
def sync_prices(db: Session = Depends(get_db)) -> dict:
	service = SyncService(db)
	return service.sync_prices_with_history()


@router.get("/status")
def get_sync_status(db: Session = Depends(get_db)) -> dict:
	price_count = db.query(func.count(CommercePrice.item_id)).scalar() or 0
	item_count = db.query(func.count(Item.id)).scalar() or 0
	recipe_count = db.query(func.count(Recipe.id)).scalar() or 0
	price_last_updated = db.query(func.max(CommercePrice.last_updated)).scalar()

	return {
		"price_last_updated": price_last_updated,
		"price_count": price_count,
		"item_count": item_count,
		"recipe_count": recipe_count,
	}


@router.get("/auto-price/status")
def get_auto_price_sync_status(db: Session = Depends(get_db)) -> dict:
	return auto_price_sync_service.status(db)


@router.post("/auto-price/pause")
def pause_auto_price_sync(db: Session = Depends(get_db)) -> dict:
	PriceHistoryService(db).update_config({"auto_price_sync_enabled": False})
	return auto_price_sync_service.status(db)


@router.post("/auto-price/resume")
def resume_auto_price_sync(db: Session = Depends(get_db)) -> dict:
	PriceHistoryService(db).update_config({"auto_price_sync_enabled": True})
	return auto_price_sync_service.status(db)


@router.get("/price-history/config")
def get_price_history_config(db: Session = Depends(get_db)) -> dict:
	return PriceHistoryService(db).get_config()


@router.patch("/price-history/config")
def update_price_history_config(
	payload: PriceHistoryConfigUpdate,
	db: Session = Depends(get_db),
) -> dict:
	return PriceHistoryService(db).update_config(payload.model_dump(exclude_unset=True))


@router.get("/price-history/estimate")
def get_price_history_estimate(db: Session = Depends(get_db)) -> dict:
	return PriceHistoryService(db).get_storage_estimate()


@router.get("/price-history/relevance")
def get_price_history_relevance(
	search: str = "",
	relevance_filter: Literal["all", "relevant", "ignored", "untracked"] = Query(
		default="relevant",
		alias="filter",
	),
	limit: int = Query(default=50, ge=1, le=200),
	offset: int = Query(default=0, ge=0),
	db: Session = Depends(get_db),
) -> dict:
	return PriceHistoryService(db).list_item_relevance(
		search=search,
		relevance_filter=relevance_filter,
		limit=limit,
		offset=offset,
	)


@router.post("/price-history/ignore/{item_id}")
def ignore_price_history_item(
	item_id: int,
	payload: IgnorePriceItemRequest | None = None,
	db: Session = Depends(get_db),
) -> dict:
	result = PriceHistoryService(db).ignore_item(
		item_id,
		reason=payload.reason if payload else None,
	)

	if result["status"] == "not_found":
		raise HTTPException(status_code=404, detail="Item not found")

	return result


@router.delete("/price-history/ignore/{item_id}")
def restore_price_history_item(item_id: int, db: Session = Depends(get_db)) -> dict:
	return PriceHistoryService(db).restore_item(item_id)
