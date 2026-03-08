# QA Checklist — Trading Dashboard V1.2 (incremental)

Date: __________
Tester: _________
Environment: local / staging / production

## A) Core health and security

- [ ] `GET /api/v1/health/runtime` -> 200
- [ ] `GET /api/v1/diagnostics/connectors` -> 200
- [ ] `GET /api/v1/diagnostics/db-writable` -> 200 + coherent writable flags
- [ ] `GET /api/v1/product/readiness?window=7d` -> 200 + coherent status (`READY|DEGRADED|ISSUES`)
- [ ] Sync endpoints blocked with invalid token

## B) Sync resilience

- [ ] Sync works when DB writable
- [ ] Sync disabled in UI when DB readonly
- [ ] Backend returns 503 for sync endpoints when DB readonly
- [ ] No `PendingRollbackError` cascade after sync failures

## C) Execution telemetry

- [ ] `GET /api/v1/execution/summary?window=24h` -> 200
- [ ] `GET /api/v1/execution/events?limit=20&offset=0` -> 200
- [ ] `GET /api/v1/execution/errors-timeseries?window=24h` -> 200
- [ ] `POST /api/v1/execution/events` logs event and returns 200

## D) Funding analytics

- [ ] `GET /api/v1/funding/trend?window=7d` -> 200
- [ ] funding trend chart renders (or empty state with unavailable source)
- [ ] top funding symbols table renders
- [ ] fee drag/funding share cards render

## E) Exit coverage quality

- [ ] `exit_exact_count`, `exit_proxy_count`, `exit_exact_coverage_pct` present in stats overview
- [ ] alert appears when exit exact coverage < 80%
- [ ] integration mode label updates coherently

## F) Frontend sanity

- [ ] `npm run build` passes
- [ ] Dynamic section toggles + presets still work
- [ ] Quick mode ops alert and incident log still work

## G) Sign-off

- [ ] no blocking issue
- [ ] docs updated for new endpoints/features
- [ ] ready for patch tag
