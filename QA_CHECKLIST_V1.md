# QA Checklist — Trading Dashboard V1

Date: __________
Tester: _________
Environment: local / staging / production

## A) Security and sync access

- [ ] `APP_ROLE=operator`, `APP_READ_ONLY=false`, valid token -> `POST /api/v1/sync/all` returns 200
- [ ] `APP_READ_ONLY=true` -> `POST /api/v1/sync/all` returns 403
- [ ] invalid token -> `POST /api/v1/sync/all` returns 401
- [ ] `APP_ROLE=viewer` -> `POST /api/v1/sync/all` returns 403
- [ ] `/api/v1/diagnostics/connectors` exposes:
  - [ ] `sync.role`
  - [ ] `sync.can_sync`
  - [ ] `sync.can_sync_reason`

## B) Core API

- [ ] `GET /health` -> 200 + status ok
- [ ] `GET /api/v1/stats/overview?window=30d` -> 200
- [ ] `GET /api/v1/stats/equity?window=30d` -> 200 + points array
- [ ] `GET /api/v1/risk/exposure` -> 200
- [ ] `GET /api/v1/trades?limit=25&offset=0&window=30d` -> 200
- [ ] `GET /api/v1/positions` -> 200
- [ ] `GET /api/v1/audit/summary?window=30d` -> 200
- [ ] `GET /api/v1/audit/trades?window=30d&limit=25&offset=0` -> 200 + checksum
- [ ] `GET /api/v1/sync/events?limit=20&offset=0` -> 200

## C) CSV exports

- [ ] `GET /api/v1/audit/trades.csv?window=30d` downloads CSV
- [ ] `GET /api/v1/sync/events.csv` downloads CSV
- [ ] Frontend exports (trades/positions/equity) produce files

## D) Frontend behavior

- [ ] Sync button disabled when `can_sync=false`
- [ ] Lock message is explicit:
  - [ ] read-only mode reason
  - [ ] viewer role reason
- [ ] Bad token displays unauthorized error
- [ ] Trades pagination/sort works
- [ ] Sync events pagination/filter works

## E) Final sign-off

- [ ] No blocking issue found
- [ ] Known limitations documented in README_OPS.md
- [ ] Ready for tag `v1.0.0`
