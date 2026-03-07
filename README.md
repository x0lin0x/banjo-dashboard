# Trading Dashboard

Minimal stack for Binance futures sync + dashboard display.

## Components

- `backend/` — FastAPI + SQLAlchemy (sync Binance, expose API)
- `new-dashboard/` — React/Vite dashboard (current preferred frontend)
- `frontend-streamlit/` — Streamlit frontend (legacy/quick UI)
- `docker-compose.yml` — Postgres + backend services

## API (backend)

Base URL: `http://localhost:8000/api/v1`

- `GET /stats/overview?window=24h|7d|30d`
- `GET /stats/equity?window=24h|7d|30d`
- `GET /risk/exposure`
- `GET /trades?limit=100&offset=0&window=24h|7d|30d&sort_by=executed_at|symbol|realized_pnl&sort_dir=asc|desc&symbol=BTCUSDT`
- `GET /positions`
- `GET /diagnostics/connectors` (db status/latency, binance mode, last sync)
- `GET /audit/summary?window=24h|7d|30d` (counts, realized, fees, checksum)
- `POST /sync/trades?symbol=BTCUSDT&limit=100`
- `POST /sync/positions`
- `POST /sync/all?symbol=BTCUSDT&limit=100`
- `POST /sync/scan-all-symbols?limit=1000`

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

Backend reads `.env` (optional) and supports:

- `DATABASE_URL` (defaults to local SQLite in non-docker runs)
- `BINANCE_API_KEY`
- `BINANCE_API_SECRET`
- `BINANCE_BASE_URL` (default `https://fapi.binance.com`)

If Binance keys are missing, sync service returns mock data for development.

## Schema notes

On startup, backend applies a lightweight runtime migration for `trades.signal_id` and `trades.decision_id` (for local SQLite / existing dev DB compatibility).
