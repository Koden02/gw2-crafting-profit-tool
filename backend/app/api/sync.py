from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.models.commerce_price import CommercePrice
from app.models.item import Item
from app.models.recipe import Recipe
from app.services.sync_service import SyncService

router = APIRouter(prefix="/api/sync", tags=["sync"])


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
def sync_prices(db: Session = Depends(get_db)) -> dict[str, int | str]:
	service = SyncService(db)
	count = service.sync_prices()
	return {"status": "ok", "prices_upserted": count}


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
