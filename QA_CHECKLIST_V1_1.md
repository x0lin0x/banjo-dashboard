# QA Checklist — Trading Dashboard V1.1

Date: __________
Tester: _________
Environment: local / staging / production

## A) Security + Sync

- [ ] `APP_ROLE=operator`, `APP_READ_ONLY=false`, valid token -> sync endpoints allowed
- [ ] `APP_READ_ONLY=true` -> sync endpoints blocked
- [ ] invalid token -> unauthorized
- [ ] diagnostics expose sync lock reason

## B) Health + Execution

- [ ] `GET /api/v1/health/runtime` -> 200
- [ ] `GET /api/v1/execution/summary?window=24h` -> 200
- [ ] `GET /api/v1/execution/events?limit=20&offset=0` -> 200
- [ ] `GET /api/v1/execution/errors-timeseries?window=24h` -> 200

## C) Risk + Perf

- [ ] `GET /api/v1/stats/overview?window=24h|7d|30d` -> 200
- [ ] current/max DD and durations are coherent
- [ ] streak metrics are coherent (current <= max)
- [ ] fee drag / funding share render without crash

## D) Funding + Costs

- [ ] funding fees card renders (value or n/a)
- [ ] top funding symbol and top funding symbols table render
- [ ] cost mix bar renders

## E) Analytics + Tables

- [ ] `GET /api/v1/analytics/closed-positions?window=7d&limit=100&offset=0` -> 200
- [ ] trades table pagination/sort/filter works
- [ ] positions table renders active positions correctly
- [ ] sync events and audit tables render and paginate

## F) UI Dynamic Sections

- [ ] section toggles show/hide blocks correctly
- [ ] presets Core/Ops/Full work
- [ ] quick mode auto-switch behaves as expected
- [ ] incident banner + acknowledge work

## G) Automated checks

- [ ] `npm run build` passes
- [ ] `BASE_URL=http://localhost:8000 ./scripts/qa_metrics_sanity_v1_1.sh` passes

## H) Sign-off

- [ ] no blocking issue
- [ ] known proxy metrics documented
- [ ] release notes updated
- [ ] ready for `v1.1.0` / post-tag patch
