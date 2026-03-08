# Trading Dashboard v1.1.3

## Scope
Patch release focused on reliability, diagnostics, and analytics quality hardening.

## Included

### Stability & DB safety
- Added startup readonly DB warning for sqlite.
- Added safe commit + rollback guards in sync/scan flows to prevent session crash cascades.
- Added backend hard-stop (503) on write sync endpoints when DB is readonly.
- Added frontend sync lock when DB writable check is false.
- Added runtime quick-fix hint (permission commands) for readonly DB incidents.

### Diagnostics
- Added `GET /api/v1/diagnostics/db-writable` endpoint.
- Added runtime DB writable badge/warning in UI.

### Execution & exit analytics
- Added optional `POST /api/v1/execution/events` ingestion endpoint for bot/runtime events.
- Added exact exit reason normalization taxonomy (`tp|sl|manual|opposite|timeout|other`).
- Added exit exact/proxy coverage metrics:
  - exact count
  - proxy count
  - exact coverage %
- Added alert when exit exact coverage < 80%.

### Funding analytics
- Added funding daily trend endpoint + chart (`GET /api/v1/funding/trend?window=...`).
- Added top funding symbols table (top 5).
- Added fee drag / cost mix visualization improvements.

### Product docs
- Added `docs/FEATURE_AVAILABILITY.md` (API-only vs API+Bot-events matrix).
- Added `docs/INTEGRATION_BOT_EVENTS.md` (optional integration contract).
- Added `QA_CHECKLIST_V1_2.md` and updated smoke checks for new endpoints.

## Notes
- Dashboard remains fully usable in API-only mode.
- Bot events integration is optional and only improves precision.
