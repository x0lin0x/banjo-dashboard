# Trading Dashboard v1.1.0

## Highlights

This release upgrades the dashboard from a basic V1 view to a more operational and analytics-focused V1.1.

### 1) Runtime & Ops Health
- Runtime health endpoint + cards:
  - bot status (running/degraded/offline)
  - heartbeat age
  - open positions count
  - API errors (24h)
- Heartbeat logging integrated for sync flows (including scan-all-symbols).

### 2) Execution Quality & Reliability
- New execution endpoints:
  - `GET /api/v1/execution/summary?window=24h|7d|30d`
  - `GET /api/v1/execution/events?limit=&offset=&status=ok|error`
  - `GET /api/v1/execution/errors-timeseries?window=...`
- Metrics:
  - total events
  - error events (window + 1h)
  - missed-like events
  - avg latency + p50/p95
- UI: execution table + hourly errors chart.
- Auto-sync cooldown after repeated sync errors.

### 3) Risk & Performance Core
- Added/strengthened:
  - current/max drawdown
  - current/max DD duration
  - current/max streaks
  - profit factor
  - expectancy
  - avg win/loss ratio
  - net PnL after fees
- Added sanity script:
  - `scripts/qa_metrics_sanity_v1_1.sh`

### 4) Closed-Position Analytics
- Deterministic closed-position derivation endpoint:
  - `GET /api/v1/analytics/closed-positions?...`
- Extended analytics:
  - win rate long vs short
  - average holding time
  - exit distribution (exact when available, proxy fallback)
  - R metrics (snapshot-first, proxy fallback):
    - avg R loss
    - avg R win
    - avg R by trade
- Added metric source metadata (`exact|snapshots|proxy|unavailable`).

### 5) Funding & Cost Drag
- Funding fee ingestion via Binance income (`FUNDING_FEE`, paginated).
- Added:
  - funding fees (window)
  - fee drag %
  - funding share %
  - trading fee share %
- Added top funding symbol + top 5 funding symbols table.
- Added visual cost mix bar (funding vs trading fee share).

### 6) Dynamic UI Foundation
- Section visibility controls with persistence.
- Presets:
  - Core
  - Ops
  - Full
- Default preset selection + quick mode auto-switch (Core/Ops).
- Ops incident alert banner + acknowledge + local incident log.

## Reliability / Quality Notes
- Front build passes (`npm run build`).
- Metrics sanity checks pass (24h/7d/30d).
- Timezone hardening applied across overview calculations.
- Session/DB hardening added for rollback safety and readonly-db startup warning.

## Known Limits
- Some metrics remain proxy when upstream source data is unavailable.
- Exit reason stays proxy if bot/exchange payload lacks explicit exit reason.
- Front bundle chunk warning (>500KB) still present (optimization deferred).
- Full UI/UX visual redesign intentionally postponed; focus is data/ops correctness.

## Suggested Next
- Ingest explicit signal/decision/exit reason from bot runtime.
- UI layout manager and card-level personalization.
- Frontend chunk/code-splitting optimization.
- Post-release hardening pass.
