from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.account import require_account
from app.db.dependencies import get_db
from app.models import AccountProfile
from app.services.batch_recommendations import BatchRecommendations
from app.services.gw2_client import GW2Client
from app.services.profit_engine import ProfitEngine
from app.services.reservation_service import AccountDataChanged

router = APIRouter(prefix="/api/craft-recommendations", tags=["crafting"])


class BatchRequest(BaseModel):
    account_id: str = Field(min_length=1, max_length=128)
    budget: int = Field(gt=0, le=100000000, strict=True)
    minimum_gain: int = Field(default=1000, ge=1, le=100000000, strict=True)
    max_output: int = Field(default=100, ge=1, le=200, strict=True)


@router.post("")
def recommend_batches(payload: BatchRequest, db: Session = Depends(get_db)) -> dict:
    require_account(db, payload.account_id)
    engine = ProfitEngine(db, payload.account_id, include_history=False)
    client = GW2Client()
    client.timeout = 5.0
    result = BatchRecommendations(engine, client.fetch_commerce_listing).find(
        payload.budget, payload.minimum_gain, payload.max_output)
    current = db.query(AccountProfile.snapshot_id, AccountProfile.reservation_revision).filter_by(id=payload.account_id).one()
    if tuple(current) != (result["snapshot_id"], result["reservation_revision"]):
        raise AccountDataChanged("Account data or reservations changed during the search. Find batches again.")
    return result
