from fastapi import APIRouter, Depends, HTTPException, Query
import httpx
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.services.gw2_client import GW2Client
from app.services.profit_engine import ProfitEngine

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
	material_pricing: str = Query(default="buy"),
	output_pricing: str = Query(default="sell"),
	db: Session = Depends(get_db),
) -> dict:
	engine = ProfitEngine(db)
	result = engine.calculate_profit(
		item_id,
		material_pricing=material_pricing,
		output_pricing=output_pricing,
	)

	if result is None:
		raise HTTPException(status_code=404, detail="Unable to calculate profit for item")

	return result


@router.get("/{item_id}/scenarios")
def get_profit_scenarios(
	item_id: int,
	db: Session = Depends(get_db),
) -> list[dict]:
	engine = ProfitEngine(db)
	results = []

	for material_pricing, output_pricing in SCENARIOS:
		result = engine.calculate_profit(
			item_id,
			material_pricing=material_pricing,
			output_pricing=output_pricing,
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
	material_pricing: str = Query(default="buy"),
	db: Session = Depends(get_db),
) -> dict:
	engine = ProfitEngine(db)
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
		material_pricing=material_pricing,
	)

	if result is None:
		raise HTTPException(status_code=404, detail="Unable to calculate listing depth for item")

	return result
