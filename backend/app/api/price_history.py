from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.services.price_history_service import PriceHistoryService

router = APIRouter(prefix="/api/price-history", tags=["price-history"])


@router.get("/{item_id}")
def get_price_history(
	item_id: int,
	range_days: int = Query(default=7, ge=1, le=3650),
	resolution: Literal["auto", "raw", "hour", "day"] = Query(default="auto"),
	db: Session = Depends(get_db),
) -> dict:
	result = PriceHistoryService(db).get_item_price_history(
		item_id=item_id,
		range_days=range_days,
		resolution=resolution,
	)

	if result is None:
		raise HTTPException(status_code=404, detail="Item not found")

	return result
