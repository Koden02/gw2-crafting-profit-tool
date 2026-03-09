from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.services.profit_engine import ProfitEngine

router = APIRouter(prefix="/api", tags=["profitable-crafts"])


@router.get("/profitable-crafts")
def get_profitable_crafts(
    limit: int = 100,
    min_profit: float = 0,
    min_buy_quantity: int = 0,
    min_sell_quantity: int = 0,
    exclude_low_liquidity: bool = False,
    exclude_suspicious_spread: bool = False,
    discipline: str | None = None,
    material_pricing: str = "buy",
    output_pricing: str = "sell",
    db: Session = Depends(get_db),
):
    engine = ProfitEngine(db)

    return engine.calculate_profit_table(
        limit=limit,
        min_profit=min_profit,
        min_buy_quantity=min_buy_quantity,
        min_sell_quantity=min_sell_quantity,
        exclude_low_liquidity=exclude_low_liquidity,
        exclude_suspicious_spread=exclude_suspicious_spread,
        discipline=discipline,
        material_pricing=material_pricing,
        output_pricing=output_pricing,
    )