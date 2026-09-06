from __future__ import annotations

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from typing import Any
from uuid import uuid4

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.account_holding import AccountHolding
from app.models.account_profile import AccountProfile, AccountStack, LEGACY_ACCOUNT_ID
from app.models.account_crafting import AccountCrafting
from app.services.account_crafting_service import collect_crafting, character_names
from app.services.gw2_client import GW2Client


class AccountMismatch(ValueError):
    pass


@dataclass(frozen=True)
class InventorySnapshot:
    """Adapter boundary for future imports: a coherent set of physical sources."""
    account_id: str
    display_name: str
    observed_at: datetime
    stacks: list[dict[str, Any]]
    coverage: dict[str, Any]
    source: str = "api"
    crafting: dict | None = None


class AccountService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.client = GW2Client()

    def sync_holdings(self, api_key: str, account_id: str | None = None, include_crafting: bool = False,
                      include_inventory: bool = False) -> dict[str, Any]:
        identity = self.client.fetch_account(api_key)
        verified_id = identity.get("id")
        if not isinstance(verified_id, str) or not verified_id or verified_id == LEGACY_ACCOUNT_ID:
            raise ValueError("GW2 did not return an account identity; nothing was changed.")
        if account_id is not None and account_id != verified_id:
            raise AccountMismatch("This key belongs to a different account. Select Add account to sync it.")
        # Fetch and validate all sources before touching the last successful snapshot.
        started = datetime.now(timezone.utc)
        materials = self.client.fetch_account_materials(api_key)
        bank = self.client.fetch_account_bank(api_key)
        stacks = self.normalize_stacks(materials, "materials") + self.normalize_stacks(bank, "bank")
        coverage = {source: {"status": "ok", "fetched_at": started.isoformat()} for source in ("materials", "bank")}
        roster = None
        if include_inventory:
            stacks.extend(self.normalize_stacks(self.client.fetch_shared_inventory(api_key), "shared"))
            names = character_names(self.client.fetch_character_names(api_key))
            roster = dict(status="ok", fetched_at=started.isoformat(), data=names)
            coverage.update(shared=dict(status="ok", fetched_at=started.isoformat()), character_roster=roster)
            def read_character(name):
                return name, self.normalize_character_inventory(self.client.fetch_character_inventory(api_key, name), name)
            with ThreadPoolExecutor(max_workers=4) as pool:
                for name, character_stacks in pool.map(read_character, names):
                    stacks.extend(character_stacks)
                    coverage["character:" + name] = dict(status="ok", fetched_at=started.isoformat())
        crafting = None
        if include_crafting:
            prior = self.db.get(AccountCrafting, verified_id)
            crafting = collect_crafting(self.client, api_key, json.loads(prior.payload) if prior else None, roster=roster)
        return self.replace_snapshot(InventorySnapshot(
            account_id=verified_id, display_name=str(identity.get("name") or verified_id),
            observed_at=started, stacks=stacks,
            coverage=coverage,
            crafting=crafting,
        ))

    @staticmethod
    def normalize_stacks(raw: Any, source: str) -> list[dict[str, Any]]:
        if not isinstance(raw, list):
            raise ValueError(f"Invalid {source} response; previous holdings were preserved.")
        stacks = []
        seen = {}
        for slot, stack in enumerate(raw):
            if stack is None and source != "materials":
                continue
            if not isinstance(stack, dict) or type(stack.get("id")) is not int or stack["id"] <= 0:
                raise ValueError(f"Invalid item in {source}; previous holdings were preserved.")
            count = stack.get("count")
            if type(count) is not int or count < 0:
                raise ValueError(f"Invalid count in {source}; previous holdings were preserved.")
            if (stack.get("binding") not in (None, "Account", "Character")
                    or ("bound_to" in stack and (not isinstance(stack["bound_to"], str) or not stack["bound_to"].strip()))):
                raise ValueError(f"Invalid binding in {source}; previous holdings were preserved.")
            position = str(stack["id"] if source == "materials" else slot)
            normalized = dict(source=source, position=position, item_id=stack["id"], count=count,
                              binding=stack.get("binding"), bound_to=stack.get("bound_to"))
            if position in seen:
                # The material catalog can list one item under multiple categories
                # (for example 97105 in categories 5 and 49). Each account row
                # repeats that item's vault balance, not another physical stack.
                if source == "materials" and seen[position] == normalized:
                    continue
                if source == "materials":
                    raise ValueError(f"Conflicting material entries for item {stack['id']}; previous holdings were preserved.")
                raise ValueError(f"Duplicate location in {source}; previous holdings were preserved.")
            seen[position] = normalized
            if count:
                stacks.append(normalized)
        return stacks

    @classmethod
    def normalize_character_inventory(cls, raw: Any, name: str) -> list[dict[str, Any]]:
        if not isinstance(raw, dict) or not isinstance(raw.get("bags"), list):
            raise ValueError("Invalid character inventory; previous holdings were preserved.")
        result = []
        for bag_index, bag in enumerate(raw["bags"]):
            if bag is None:
                continue
            if (not isinstance(bag, dict) or type(bag.get("size")) is not int
                    or not isinstance(bag.get("inventory"), list) or bag["size"] != len(bag["inventory"])):
                raise ValueError("Incomplete character bag; previous holdings were preserved.")
            for stack in cls.normalize_stacks(bag["inventory"], "character:" + name):
                stack["position"] = f"{bag_index}:{stack['position']}"
                result.append(stack)
        # Bag item IDs, equipment and embedded upgrades are deliberately not stacks.
        return result

    def replace_snapshot(self, snapshot: InventorySnapshot) -> dict[str, Any]:
        if snapshot.account_id == LEGACY_ACCOUNT_ID or snapshot.source != "api":
            raise ValueError("Only identified API snapshots are supported in this milestone.")
        try:
            # Acquire SQLite's write lock before reading the current snapshot, even
            # for a new account. Concurrent refreshes must compare against the last
            # committed version rather than a Session's cached profile.
            self.db.execute(update(AccountProfile).where(AccountProfile.id == snapshot.account_id)
                            .values(id=snapshot.account_id))
            profile = self.db.get(AccountProfile, snapshot.account_id, populate_existing=True)
            if profile and profile.last_updated:
                prior = profile.last_updated.replace(tzinfo=timezone.utc)
                if prior > snapshot.observed_at:
                    raise ValueError("A newer snapshot already exists; refresh again.")
            coverage = json.loads(profile.coverage or "{}") if profile else {}
            replaced = {"materials", "bank"} | (set(snapshot.coverage) - {"character_roster"})
            if "character_roster" in snapshot.coverage:
                # A fresh roster also removes sources belonging to deleted characters.
                replaced.update(name for name in coverage if name.startswith("character:"))
            preserved = [dict(source=row.source, position=row.position, item_id=row.item_id,
                              count=row.count, binding=row.binding, bound_to=row.bound_to)
                         for row in self.db.query(AccountStack).filter_by(account_id=snapshot.account_id).all()
                         if row.source not in replaced]
            stacks = preserved + snapshot.stacks
            for name in replaced:
                coverage.pop(name, None)
            coverage.update(snapshot.coverage)
            totals: dict[int, dict[str, int]] = defaultdict(lambda: dict(materials=0, bank=0, shared=0, character=0, usable=0))
            for stack in stacks:
                total = totals[stack["item_id"]]
                category = "character" if stack["source"].startswith("character:") else stack["source"]
                total[category] += stack["count"]
                if not stack["binding"] and not stack["bound_to"]:
                    total["usable"] += stack["count"]
            if profile is None:
                profile = AccountProfile(id=snapshot.account_id)
                self.db.add(profile)
            profile.display_name = snapshot.display_name
            profile.verified = True
            profile.source = snapshot.source
            profile.snapshot_id = str(uuid4())
            profile.last_updated = snapshot.observed_at
            profile.coverage = json.dumps(coverage)
            capabilities = self.db.get(AccountCrafting, snapshot.account_id)
            if snapshot.crafting is not None:
                if capabilities is None:
                    capabilities = AccountCrafting(account_id=snapshot.account_id)
                    self.db.add(capabilities)
                capabilities.payload = json.dumps(snapshot.crafting)
            if capabilities is not None:
                # A holdings-only refresh keeps source observation times unchanged.
                capabilities.snapshot_id = profile.snapshot_id
            self.db.query(AccountHolding).filter_by(account_id=snapshot.account_id).delete()
            self.db.query(AccountStack).filter_by(account_id=snapshot.account_id).delete()
            for stack in stacks:
                self.db.add(AccountStack(account_id=snapshot.account_id, **stack))
            for item_id, total in totals.items():
                self.db.add(AccountHolding(
                    account_id=snapshot.account_id, item_id=item_id,
                    material_count=total["materials"], bank_count=total["bank"],
                    shared_count=total["shared"], character_count=total["character"],
                    total_count=sum(total[k] for k in ("materials", "bank", "shared", "character")), usable_count=total["usable"],
                    last_updated=snapshot.observed_at,
                ))
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return dict(status="ok", account_id=snapshot.account_id, snapshot_id=profile.snapshot_id,
                    material_items=sum(t["materials"] > 0 for t in totals.values()),
                    bank_items=sum(t["bank"] > 0 for t in totals.values()), unique_items=len(totals),
                    shared_items=sum(t["shared"] > 0 for t in totals.values()),
                    character_items=sum(t["character"] > 0 for t in totals.values()),
                    total_owned=sum(sum(t[k] for k in ("materials", "bank", "shared", "character")) for t in totals.values()),
                    last_updated=snapshot.observed_at)
