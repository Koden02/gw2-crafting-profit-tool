from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
import httpx
import json
from sqlalchemy import and_, or_

from app.db.dependencies import get_db
from app.models.account_holding import AccountHolding
from app.models.account_profile import AccountProfile, LEGACY_ACCOUNT_ID
from app.services.account_service import AccountService, AccountMismatch
from app.services.price_history_service import normalize_datetime
from app.models import AccountCrafting, MaterialReservation, Item
from app.services.crafting_eligibility import fresh
from app.services.reservation_service import set_reservation

router = APIRouter(prefix="/api/account", tags=["account"])


class AccountSyncRequest(BaseModel):
	api_key: str = Field(min_length=1)
	account_id: str | None = None
	include_crafting: bool = True


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
		return service.sync_holdings(api_key, payload.account_id, payload.include_crafting)
	except AccountMismatch as exc:
		raise HTTPException(status_code=409, detail=str(exc)) from exc
	except ValueError as exc:
		raise HTTPException(status_code=422, detail=str(exc)) from exc
	except httpx.RequestError as exc:
		raise HTTPException(status_code=502, detail="Account refresh failed; previous holdings were preserved.") from exc
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
def get_account_holdings_status(account_id: str, db: Session = Depends(get_db)) -> dict:
	profile = require_account(db, account_id)
	query = db.query(AccountHolding).filter_by(account_id=account_id)
	holding_count = query.count()
	total_owned = sum(row.total_count for row in query.all())
	last_updated = normalize_datetime(profile.last_updated)

	return {
		"account_id": account_id,
		"snapshot_id": profile.snapshot_id,
		"reservation_revision": profile.reservation_revision,
		"source": profile.source,
		"coverage": profile.coverage,
		"holding_count": holding_count,
		"total_owned": total_owned,
		"last_updated": last_updated,
	}


def require_account(db: Session, account_id: str) -> AccountProfile:
	profile = db.get(AccountProfile, account_id)
	if profile is None or not profile.verified or account_id == LEGACY_ACCOUNT_ID:
		raise HTTPException(status_code=404, detail="Select a verified account. Legacy holdings cannot be allocated.")
	return profile


@router.get("/profiles")
def get_profiles(db: Session = Depends(get_db)) -> list[dict]:
	return [{"id": p.id, "display_name": p.display_name, "verified": p.verified,
	         "last_updated": normalize_datetime(p.last_updated), "snapshot_id": p.snapshot_id,
	         "reservation_revision": p.reservation_revision}
	        for p in db.query(AccountProfile).order_by(AccountProfile.display_name).all()]


@router.get("/crafting")
def get_crafting_status(account_id: str, db: Session = Depends(get_db)) -> dict:
    require_account(db, account_id)
    row = db.get(AccountCrafting, account_id)
    payload = json.loads(row.payload) if row else {}
    def summary(source):
        return dict(status=source.get("status", "missing"), fresh=fresh(source),
                    fetched_at=source.get("fetched_at"), error=source.get("error"),
                    count=len(source.get("data", [])))
    return dict(account_id=account_id, snapshot_id=row.snapshot_id if row else None,
        characters_source=summary(payload.get("characters", {})),
        account_recipes_source=summary(payload.get("account_recipes", {})),
        characters=[dict(name=name, crafting=summary(data.get("crafting", {})),
                         disciplines=data.get("crafting", {}).get("data", []),
                         recipes=summary(data.get("recipes", {})))
                    for name, data in sorted(payload.get("by_character", {}).items())])


class ReservationUpdate(BaseModel):
    quantity: int = Field(ge=0, le=1000000000, strict=True)
    purpose: str = Field(default="", max_length=160)
    expected_revision: int = Field(ge=0, strict=True)


@router.put("/reservations/{item_id}")
def update_reservation(item_id: int, payload: ReservationUpdate, account_id: str, db: Session = Depends(get_db)) -> dict:
    require_account(db, account_id)
    from app.services.reservation_service import AccountDataChanged
    try:
        return set_reservation(db, account_id, item_id, payload.quantity, payload.purpose, payload.expected_revision)
    except AccountDataChanged as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/materials")
def get_account_materials(account_id: str, search: str = "", limit: int = Query(default=50, ge=1, le=100), db: Session = Depends(get_db)) -> dict:
    profile = require_account(db, account_id)
    query = (db.query(Item, AccountHolding, MaterialReservation)
        .outerjoin(AccountHolding, and_(AccountHolding.account_id == account_id, AccountHolding.item_id == Item.id))
        .outerjoin(MaterialReservation, and_(MaterialReservation.account_id == account_id, MaterialReservation.item_id == Item.id))
        .filter(or_(AccountHolding.item_id.isnot(None), MaterialReservation.item_id.isnot(None))))
    if search.strip():
        query = query.filter(Item.name.contains(search.strip(), autoescape=True))
    total = query.count()
    rows = []
    for item, holding, reservation in query.order_by(Item.name).limit(limit):
        flags = json.loads(item.flags or "[]")
        usable = holding.usable_count if holding and not {"AccountBound", "SoulbindOnAcquire"}.intersection(flags) else 0
        reserved = reservation.quantity if reservation else 0
        rows.append(dict(item_id=item.id, name=item.name, owned=holding.total_count if holding else 0,
                         usable=usable, reserved=reserved, available=max(0, usable-reserved),
                         purpose=reservation.purpose if reservation else ""))
    return dict(account_id=account_id, snapshot_id=profile.snapshot_id,
                reservation_revision=profile.reservation_revision, total=total, rows=rows)
