from typing import Literal
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.services.profit_engine import ProfitEngine
from app.api.account import require_account

router = APIRouter(prefix="/api", tags=["profitable-crafts"])


@router.get("/profitable-crafts")
def get_profitable_crafts(
    limit: int = Query(default=100, ge=1, le=1000),
    account_id: str | None = None,
    eligible_only: bool = False,
    min_profit: float = 0,
    min_buy_quantity: int = 0,
    min_sell_quantity: int = 0,
    exclude_low_liquidity: bool = False,
    exclude_suspicious_spread: bool = False,
    exclude_stalled_markets: bool = False,
    discipline: str | None = None,
    material_pricing: Literal["buy", "sell"] = "buy",
    output_pricing: Literal["buy", "sell"] = "sell",
    db: Session = Depends(get_db),
):
    if eligible_only and not account_id:
        raise HTTPException(status_code=422, detail="Select an account for eligible crafts.")
    if account_id:
        require_account(db, account_id)
    engine = ProfitEngine(db, account_id)

    return engine.calculate_profit_table(
        limit=limit,
        min_profit=min_profit,
        min_buy_quantity=min_buy_quantity,
        min_sell_quantity=min_sell_quantity,
        exclude_low_liquidity=exclude_low_liquidity,
        exclude_suspicious_spread=exclude_suspicious_spread,
        exclude_stalled_markets=exclude_stalled_markets,
        discipline=discipline,
        material_pricing=material_pricing,
        output_pricing=output_pricing,
        eligible_only=eligible_only,
    )
