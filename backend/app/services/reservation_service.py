from sqlalchemy import update

from app.models import AccountProfile, MaterialReservation, Item
from app.models.account_profile import LEGACY_ACCOUNT_ID


class AccountDataChanged(ValueError):
    pass


def set_reservation(db, account_id, item_id, quantity, purpose, expected_revision):
    try:
        db.execute(update(AccountProfile).where(AccountProfile.id == account_id).values(id=account_id))
        profile = db.get(AccountProfile, account_id, populate_existing=True)
        if not profile or not profile.verified or account_id == LEGACY_ACCOUNT_ID:
            raise ValueError("Select a verified account.")
        if profile.reservation_revision != expected_revision:
            raise AccountDataChanged("Reservations changed in another request. Reload before saving.")
        if db.get(Item, item_id) is None:
            raise ValueError("Unknown item; sync items first.")
        row = db.get(MaterialReservation, (account_id, item_id))
        if quantity == 0:
            if row:
                db.delete(row)
        else:
            if row is None:
                row = MaterialReservation(account_id=account_id, item_id=item_id)
                db.add(row)
            row.quantity, row.purpose = quantity, purpose.strip()
        profile.reservation_revision += 1
        db.commit()
        return dict(account_id=account_id, reservation_revision=profile.reservation_revision)
    except Exception:
        db.rollback()
        raise
