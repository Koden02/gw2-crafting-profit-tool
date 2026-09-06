# Release Notes

## Unreleased

- Added verified account selection with isolated holdings, crafting capabilities, reservations, watchlists and saved filters.
- Added transactional SQLite upgrades that preserve public caches and retain legacy holdings with an unknown owner and no allocatable stock.
- Replaced unit-only recipe costing with whole-batch shopping plans, recipe alternatives, shared ingredient allocation and cycle protection.
- Separated purchase costs, upfront gold, cash surplus and economic gain after valuing consumed owned materials.
- Added selected-account crafting eligibility with named crafters, recipe unlock checks and explicit missing or stale source coverage.
- Added account-scoped material reservations and optional budget and two-sided market-depth checks.
- Added regression coverage for migrations, account isolation, eligibility, reservations and quote consistency.
- Existing installations must restart the backend, refresh recipes and prices, and sync an explicitly selected account; see [upgrade instructions and remaining limitations](ACCOUNT_QUOTES.md).

## v0.2.0

- Added a read-only `/api/price-history/{item_id}` endpoint for per-item local price history.
- Added automatic raw, hourly, or daily history resolution selection based on configured retention windows.
- Added an item detail drawer price-history panel with range controls and buy/sell price charting.
- Added price-history availability indicators to the profitable crafts table.
- Added an empty-history Sync Prices action and rollup min/max range markers to the chart.
- Added snapshot-based market flow scoring with moving, slow, stalled, and unknown labels.
- Added an Exclude Stalled Markets filter and changed the ROI summary card to prefer actionable markets.
- Added backend endpoint coverage for raw snapshots, rollup history, and missing items.
- Bumped frontend package metadata and project docs to `0.2.0`.

## v0.1.12

- Moved automatic price-history settings out of the crafts page and into a dedicated Options page.
- Moved tracked item review and ignore/restore controls into a dedicated Tracked Items page.
- Added top-level navigation between Crafts, Options, and Tracked Items.
- Added hover explanations to automatic price-history metric boxes and settings inputs.

## v0.1.11

Stabilization checkpoint before `0.2.0`.

### Highlights

- Added shared Trading Post price-sync overlap protection across manual and automatic syncs.
- Manual price sync now returns a conflict instead of starting while another price sync is active.
- Automatic price sync reports shared running status, source, and start time.
- Expanded backend coverage for price-history behavior:
  - manual sync snapshot capture
  - sync overlap conflict
  - config persistence
  - ignored items excluded from snapshots
  - raw snapshot rollup and retention pruning
  - max estimated history-size pruning
  - relevance and ignore/restore controls
- Updated frontend API handling so sync-conflict messages surface clearly.

### Release Checklist

```powershell
cd backend
venv\Scripts\python.exe -m pytest
```

```powershell
cd frontend
npm run lint
npm run build
```

Manual smoke checks:

- Start backend and frontend.
- Confirm `/api/health` returns `{"status":"ok"}`.
- Confirm `/api/sync/auto-price/status` returns automatic price-sync status.
- Confirm the frontend Data Sync panel shows automatic price history controls.
- Pause and resume automatic price sync from the frontend.
- Run manual `Sync Prices` and confirm the status refreshes.

### Notes

- Automatic price sync defaults to 15 minutes.
- Raw price snapshots default to relevant items only.
- Raw snapshots default to 14 days of retention.
- Hourly rollups default to 90 days.
- Daily rollups default to 365 days.
- Max estimated history storage defaults to 5120 MB.

## v0.1.10

- Added server-side automatic Trading Post price sync.
- Added configurable local price history snapshots and rollups.
- Added storage estimates and ignored-item controls.

## v0.1.9

- Added API smoke coverage.
- Hid debug endpoints from generated OpenAPI docs.
- Improved empty states in the profitable crafts table.
