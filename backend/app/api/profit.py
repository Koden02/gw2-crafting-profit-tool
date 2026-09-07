from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
import httpx
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.services.gw2_client import GW2Client
from app.services.profit_engine import ProfitEngine
from app.services.craft_planner import CraftPlanner
from app.services.order_planner import OrderAwarePlanner
from app.models import AccountProfile
from app.services.reservation_service import AccountDataChanged
from app.api.account import require_account

router = APIRouter(prefix="/api/profit", tags=["profit"])

SCENARIOS = [
	("buy", "sell"),
	("buy", "buy"),
	("sell", "sell"),
	("sell", "buy"),
]


@router.get("/{item_id}")
def get_profit(
	item_id: int,
	recipe_id: int | None = None,
	account_id: str | None = None,
	eligible_only: bool = False,
	liquidation_pricing: Literal["buy", "sell"] | None = None,
	material_pricing: Literal["buy", "sell"] = Query(default="buy"),
	output_pricing: Literal["buy", "sell"] = Query(default="sell"),
	db: Session = Depends(get_db),
) -> dict:
	if eligible_only and not account_id:
		raise HTTPException(status_code=422, detail="Select an account for eligible crafts.")
	if account_id:
		require_account(db, account_id)
	engine = ProfitEngine(db, account_id, root_item_id=item_id)
	result = engine.calculate_profit(
		item_id,
		material_pricing=material_pricing,
		output_pricing=output_pricing,
		liquidation_pricing=liquidation_pricing,
		recipe_id=recipe_id,
		eligible_only=eligible_only,
	)

	if result is None:
		raise HTTPException(status_code=404, detail="Unable to calculate profit for item")

	return result


@router.get("/{item_id}/scenarios")
def get_profit_scenarios(
	item_id: int,
	recipe_id: int | None = None,
	account_id: str | None = None,
	eligible_only: bool = False,
	db: Session = Depends(get_db),
) -> list[dict]:
	if eligible_only and not account_id:
		raise HTTPException(status_code=422, detail="Select an account for eligible crafts.")
	if account_id:
		require_account(db, account_id)
	engine = ProfitEngine(db, account_id, root_item_id=item_id)
	results = []

	for material_pricing, output_pricing in SCENARIOS:
		result = engine.calculate_profit(
			item_id,
			material_pricing=material_pricing,
			output_pricing=output_pricing,
			recipe_id=recipe_id,
			eligible_only=eligible_only,
		)

		if result is None:
			continue

		results.append(
			{
				**result,
				"material_pricing": material_pricing,
				"output_pricing": output_pricing,
			}
		)

	if not results:
		raise HTTPException(status_code=404, detail="Unable to calculate profit scenarios for item")

	return results


@router.get("/{item_id}/listing-depth")
def get_profit_listing_depth(
	item_id: int,
	account_id: str | None = None,
	eligible_only: bool = False,
	recipe_id: int | None = None,
	material_pricing: Literal["buy", "sell"] = Query(default="buy"),
	output_pricing: Literal["buy", "sell"] = Query(default="sell"),
	db: Session = Depends(get_db),
) -> dict:
	if eligible_only and not account_id:
		raise HTTPException(status_code=422, detail="Select an account for eligible crafts.")
	if account_id:
		require_account(db, account_id)
	engine = ProfitEngine(db, account_id, include_history=False, root_item_id=item_id)
	client = GW2Client()

	try:
		listing_data = client.fetch_commerce_listing(item_id)
	except httpx.HTTPStatusError as exc:
		status_code = exc.response.status_code

		if status_code == 404:
			raise HTTPException(status_code=404, detail="Trading Post listings not found for item") from exc

		if status_code == 429:
			raise HTTPException(status_code=429, detail="GW2 API rate limit reached. Try again later.") from exc

		raise HTTPException(
			status_code=502,
			detail=f"GW2 API listing-depth request failed with status {status_code}.",
		) from exc

	result = engine.calculate_listing_depth(
		item_id,
		listing_data,
		recipe_id=recipe_id,
		eligible_only=eligible_only,
		material_pricing=material_pricing,
		output_pricing=output_pricing,
	)

	if result is None:
		raise HTTPException(status_code=404, detail="Unable to calculate listing depth for item")

	return result


@router.get("/{item_id}/plan")
def get_craft_plan(
    item_id: int,
    quantity: int = Query(default=1, ge=1, le=100000),
    account_id: str | None = None,
    material_pricing: Literal["buy", "sell"] = "buy",
    output_pricing: Literal["buy", "sell"] = "sell",
    liquidation_pricing: Literal["buy", "sell"] | None = None,
    budget: int | None = Query(default=None, ge=0),
    recipe_id: int | None = None,
    check_depth: bool = False,
    eligible_only: bool = True,
    use_trading_post: bool = False,
    inventory_only: bool = False,
    db: Session = Depends(get_db),
) -> dict:
    if account_id:
        require_account(db, account_id)
    if inventory_only and (not account_id or use_trading_post):
        raise HTTPException(status_code=422, detail="Crafting from inventory requires an account and excludes Trading Post purchases.")
    if use_trading_post and (not account_id or material_pricing != "buy" or output_pricing != "buy"):
        raise HTTPException(status_code=422, detail="Trading Post planning requires an account, material buy orders and instant-sell output pricing.")
    engine = ProfitEngine(db, account_id, include_history=False, root_item_id=item_id)
    client = GW2Client()
    client.timeout = 5.0
    expected_version = (engine.profile.snapshot_id, engine.profile.reservation_revision) if account_id else None
    planner_type = OrderAwarePlanner if use_trading_post else CraftPlanner
    planner = planner_type(engine, material_pricing, output_pricing, liquidation_pricing,
                           listing_provider=client.fetch_commerce_listing if check_depth else None,
                           require_eligible=(eligible_only or inventory_only) and account_id is not None,
                           inventory_only=inventory_only)
    result = planner.build(item_id, quantity, use_owned=account_id is not None,
                           budget=budget, recipe_id=recipe_id)
    if account_id:
        current = db.query(AccountProfile.snapshot_id, AccountProfile.reservation_revision).filter_by(id=account_id).one()
        if tuple(current) != expected_version:
            raise AccountDataChanged("Account data or reservations changed during the quote. Refresh the plan.")
    return result
