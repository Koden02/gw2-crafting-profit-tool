"""Physical inventory source coverage, independent of crafting capability coverage."""
import json

from app.services.crafting_eligibility import fresh


def source_fresh(source):
    return isinstance(source, dict) and fresh({**source, "data": source.get("data", [])})


def inventory_coverage(profile):
    coverage = json.loads(profile.coverage or "{}") if profile else {}
    roster = coverage.get("character_roster", {})
    names = roster.get("data", [])
    valid_roster = isinstance(names, list) and all(isinstance(name, str) for name in names)
    required = ["materials", "bank", "shared", "character_roster"]
    if valid_roster:
        required.extend("character:" + name for name in names)
    missing = [name for name in required if not source_fresh(coverage.get(name))]
    return dict(complete=valid_roster and not missing, missing_or_stale=missing,
                sources=[dict(source=name, fresh=source_fresh(value),
                              fetched_at=value.get("fetched_at"), status=value.get("status", "missing"))
                         for name, value in sorted(coverage.items()) if isinstance(value, dict)])
