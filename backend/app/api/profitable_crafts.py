from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.services.profit_engine import ProfitEngine

router = APIRouter(prefix="/api", tags=["profitable-crafts"])


@router.get("/profitable-crafts")
def get_profitable_crafts(
	limit: int = Query(default=100, ge=1, le=1000),
	min_profit: float = Query(default=0.0),
	min_buy_quantity: int = Query(default=0, ge=0),
	min_sell_quantity: int = Query(default=0, ge=0),
	exclude_low_liquidity: bool = Query(default=False),
	exclude_suspicious_spread: bool = Query(default=False),
	discipline: str | None = Query(default=None),
	db: Session = Depends(get_db),
) -> list[dict]:
	engine = ProfitEngine(db)
	return engine.calculate_profit_table(
		limit=limit,
		min_profit=min_profit,
		min_buy_quantity=min_buy_quantity,
		min_sell_quantity=min_sell_quantity,
		exclude_low_liquidity=exclude_low_liquidity,
		exclude_suspicious_spread=exclude_suspicious_spread,
		discipline=discipline,
	)