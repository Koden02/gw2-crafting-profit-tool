from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session
import httpx

from app.db.dependencies import get_db
from app.models.account_holding import AccountHolding
from app.services.account_service import AccountService

router = APIRouter(prefix="/api/account", tags=["account"])


class AccountSyncRequest(BaseModel):
	api_key: str = Field(min_length=1)


@router.post("/sync/holdings")
def sync_account_holdings(
	payload: AccountSyncRequest,
	db: Session = Depends(get_db),
) -> dict:
	api_key = payload.api_key.strip()

	if not api_key:
		raise HTTPException(status_code=422, detail="GW2 API key is required")

	service = AccountService(db)

	try:
		return service.sync_holdings(api_key)
	except httpx.HTTPStatusError as exc:
		status_code = exc.response.status_code

		if status_code in {401, 403}:
			raise HTTPException(
				status_code=401,
				detail="GW2 API key was rejected. Use a key with account and inventories permissions.",
			) from exc

		if status_code == 429:
			raise HTTPException(
				status_code=429,
				detail="GW2 API rate limit reached. Try again later.",
			) from exc

		raise HTTPException(
			status_code=502,
			detail=f"GW2 API account sync failed with status {status_code}.",
		) from exc


@router.get("/holdings/status")
def get_account_holdings_status(db: Session = Depends(get_db)) -> dict:
	holding_count = db.query(func.count(AccountHolding.item_id)).scalar() or 0
	total_owned = db.query(func.sum(AccountHolding.total_count)).scalar() or 0
	last_updated = db.query(func.max(AccountHolding.last_updated)).scalar()

	return {
		"holding_count": holding_count,
		"total_owned": total_owned,
		"last_updated": last_updated,
	}
