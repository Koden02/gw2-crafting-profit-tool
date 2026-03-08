from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.services.profit_engine import ProfitEngine

router = APIRouter(prefix="/api", tags=["profitable-crafts"])


@router.get("/profitable-crafts")
def get_profitable_crafts(
	limit: int = Query(default=100, ge=1, le=1000),
	min_profit: float = Query(default=0.0),
	db: Session = Depends(get_db),
) -> list[dict]:
	engine = ProfitEngine(db)
	return engine.calculate_profit_table(
		limit=limit,
		min_profit=min_profit,
	)