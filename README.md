# Trading Dashboard

Minimal stack for Binance futures sync + dashboard display.

## Components

- `backend/` — FastAPI + SQLAlchemy (sync Binance, expose API)
- `new-dashboard/` — React/Vite dashboard (current preferred frontend)
- `frontend-streamlit/` — Streamlit frontend (legacy/quick UI)
- `docker-compose.yml` — Postgres + backend services

## API (backend)

Base URL: `http://localhost:8000/api/v1`

- `GET /stats/overview?window=24h|7d|30d|90d|all` (includes active positions count, balance/ATH/DD, R-metrics by closed position, win-rate long/short, avg holding time, exit distribution exact/proxy, funding fees, fee drag %, funding share %)
- `GET /stats/equity?window=24h|7d|30d|90d|all`
- `GET /risk/exposure`
- `GET /trades?limit=100&offset=0&window=24h|7d|30d|90d|all&sort_by=executed_at|symbol|realized_pnl&sort_dir=asc|desc&symbol=BTCUSDT` (aggregated by order/fills)
- `GET /positions?include_zero=false` (default hides zero-notional rows)
- `GET /analytics/closed-positions?window=24h|7d|30d|90d|all&limit=100&offset=0` (derived closed-position ledger)
- `GET /diagnostics/connectors` (db status/latency, binance mode, last sync, security mode)
- `GET /diagnostics/db-writable` (sqlite writability check: file/dir permissions)
- `GET /product/readiness?window=24h|7d|30d|90d|all` (global readiness status: db/heartbeat/execution/exit coverage/funding)
- `GET /health/runtime` (bot status, heartbeat age/source/status, open positions, open uPnL, API errors 24h)
- `POST /health/heartbeat` (optional bot-native heartbeat ingestion)
- `GET /execution/summary?window=24h|7d|30d|90d|all` (events count, errors, errors_1h, missed-like, avg latency, p50, p95)
- `GET /execution/events?limit=20&offset=0&status=ok|error` (latest execution telemetry)
- `POST /execution/events` (bot/runtime ingestion for execution telemetry + optional exact exit reason updates)
- `GET /execution/errors-timeseries?window=24h|7d|30d|90d|all` (error count by hour)
- `GET /funding/trend?window=24h|7d|30d|90d|all` (daily funding fee trend)
- `GET /sync/events?limit=20&offset=0&endpoint=sync/all&status=ok|error` (latest sync action logs, filterable)
- `GET /sync/events.csv?endpoint=sync/all&status=ok|error` (sync events CSV export)
- `GET /audit/summary?window=24h|7d|30d|90d|all` (counts, realized, fees, checksum)
- `GET /audit/trades?window=24h|7d|30d|90d|all&limit=100&offset=0` (paged audit rows + page checksum)
- `GET /audit/trades.csv?window=24h|7d|30d|90d|all` (backend CSV export)
- `POST /sync/trades?symbol=BTCUSDT&limit=100`
- `POST /sync/positions`
- `POST /sync/all?symbol=BTCUSDT&limit=100`
- `POST /sync/scan-all-symbols?limit=1000&lookback_days=30&max_recent_symbols=60&include_income_discovery=true&max_income_pages=10`
- `POST /sync/backfill-trades?symbols=BTCUSDT,ETHUSDT&days=90&limit=1000&max_pages_per_symbol=200`

Health: `GET /health`

## Quickstart (Docker)

From `trading-dashboard/`:

```bash
docker compose up --build -d
curl http://localhost:8000/health
curl http://localhost:8000/api/v1/stats/overview
```

Then sync sample data:

```bash
curl -X POST "http://localhost:8000/api/v1/sync/all?symbol=BTCUSDT&limit=100"
```

## Run frontend (React)

```bash
cd new-dashboard
npm install
npm run dev
```

Open the Vite URL (typically `http://localhost:5173`).

## Run frontend (Streamlit)

```bash
cd frontend-streamlit
pip install -r requirements.txt
streamlit run app.py
```

## Environment

Backend reads `.env` (optional) and supports.

Bootstrap config:
```bash
cd backend
cp .env.example .env
```

Supported variables:

- `DATABASE_URL` (defaults to local SQLite in non-docker runs)
- `BINANCE_API_KEY`
- `BINANCE_API_SECRET`
- `BINANCE_BASE_URL` (default `https://fapi.binance.com`)
- `APP_ENV` (`development|staging|production`, default `development`)
- `APP_ROLE` (`operator|viewer`, `viewer` cannot call `/sync/*`)
- `APP_READ_ONLY` (`true|false`, when true all `/sync/*` are disabled)
- `SYNC_API_TOKEN` (optional; when set, required via `X-API-Token` header for `/sync/*`)
- `SYNC_MIN_INTERVAL_SECONDS` (default `5`, in-memory rate limit per actor+endpoint)

Security note:
- Outside `APP_ENV=development`, if `SYNC_API_TOKEN` is set it must be **at least 32 chars**.

If Binance keys are missing, sync service returns mock data for development.

## Operations

See `README_OPS.md` for start/stop, troubleshooting, token rotation, and V1 validation checklist.

## Product docs

- `docs/FEATURE_AVAILABILITY.md` — API-only vs API+Bot-events capability matrix
- `docs/INTEGRATION_BOT_EVENTS.md` — optional bot event ingestion contract

## Schema notes

On startup, backend applies lightweight runtime migrations for trade traceability fields (`signal_id`, `decision_id`, `exit_reason`) on local/dev DBs.
