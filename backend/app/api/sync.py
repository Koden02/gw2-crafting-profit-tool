from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
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