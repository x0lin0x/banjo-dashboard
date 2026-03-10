# Trading Dashboard — Quick Commands (Copy/Paste)

## 1) Start stack (dev)

### Backend
```bash
cd /home/guts/clawd/trading-dashboard/backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend
```bash
cd /home/guts/clawd/trading-dashboard/new-dashboard
npm run dev -- --host 0.0.0.0 --port 5173
```

---

## 2) Basic health checks

```bash
curl -s http://localhost:8000/health; echo
curl -s "http://localhost:8000/api/v1/diagnostics/connectors"; echo
curl -s "http://localhost:8000/api/v1/health/runtime"; echo
```

---

## 3) Sync now (broad symbols coverage)

```bash
curl -sS -X POST "http://localhost:8000/api/v1/sync/scan-all-symbols?limit=200&lookback_days=7&max_recent_symbols=120&include_income_discovery=true&max_income_pages=30&per_symbol_delay_ms=200" \
  -H "X-API-Token: banjo-secret"; echo
```

---

## 4) Historical backfill (trades)

```bash
curl -sS -X POST "http://localhost:8000/api/v1/sync/backfill-trades?symbols=BTCUSDT,ETHUSDT,SOLUSDT,ONDOUSDT,ENAUSDT,HBARUSDT,POLUSDT,FETUSDT&days=90&limit=1000&max_pages_per_symbol=200" \
  -H "X-API-Token: banjo-secret"; echo
```

---

## 5) Verify local DB coverage

```bash
sqlite3 /home/guts/.openclaw/workspace/trading-dashboard/backend/trading.db "select min(executed_at), max(executed_at), count(*) from trades;"
sqlite3 /home/guts/.openclaw/workspace/trading-dashboard/backend/trading.db "select min(created_at), max(created_at), count(*) from execution_events;"
sqlite3 /home/guts/.openclaw/workspace/trading-dashboard/backend/trading.db "select min(created_at), max(created_at), count(*) from sync_events;"
```

---

## 6) Compare windows quickly

```bash
curl -s "http://localhost:8000/api/v1/execution/summary?window=7d"; echo
curl -s "http://localhost:8000/api/v1/execution/summary?window=30d"; echo
curl -s "http://localhost:8000/api/v1/stats/overview?window=7d"; echo
curl -s "http://localhost:8000/api/v1/stats/overview?window=30d"; echo
curl -s "http://localhost:8000/api/v1/stats/overview?window=90d"; echo
curl -s "http://localhost:8000/api/v1/stats/overview?window=all"; echo
```

---

## 7) Common errors

### Unauthorized
- Verify token header exactly: `X-API-Token: <token>`

### Rate limit 429
- Wait `SYNC_MIN_INTERVAL_SECONDS` then retry

### 7D positions lower than Binance UI
- Run command in section 3 (broad sync scan)
- Recheck after sync completes
