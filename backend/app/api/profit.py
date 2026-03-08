from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.services.profit_engine import ProfitEngine

router = APIRouter(prefix="/api/profit", tags=["profit"])


@router.get("/{item_id}")
def get_profit(item_id: int, db: Session = Depends(get_db)) -> dict:
	engine = ProfitEngine(db)
	result = engine.calculate_profit(item_id)

	if result is None:
		raise HTTPException(status_code=404, detail="Unable to calculate profit for item")

	return result