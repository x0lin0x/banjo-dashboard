# Trading Dashboard — Ops Runbook (V1)

## 1) Start / Stop

### Backend
```bash
cd /home/guts/.openclaw/workspace/trading-dashboard/backend
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend
```bash
cd /home/guts/.openclaw/workspace/trading-dashboard/new-dashboard
npm run dev -- --host 0.0.0.0 --port 5173
```

### Health checks
```bash
curl http://localhost:8000/health
curl "http://localhost:8000/api/v1/diagnostics/connectors"
```

---

## 2) Sync authorization model

Sync endpoints (`/api/v1/sync/*`) are allowed only if all are true:
1. `APP_ROLE=operator`
2. `APP_READ_ONLY=false`
3. if `SYNC_API_TOKEN` is set, request header `X-API-Token` must match

Extra hardening:
- if `APP_ENV != development` and `SYNC_API_TOKEN` is set, token length must be >= 32.

---

## 3) Common incidents

### A) "Sync locked" in UI
Check `/api/v1/diagnostics/connectors`, field `sync.can_sync_reason`:
- `app_read_only` -> set `APP_READ_ONLY=false`
- `role_viewer` -> set `APP_ROLE=operator`

Restart backend after `.env` changes.

### B) "Unauthorized: missing or invalid sync token"
- ensure the UI token input matches backend `SYNC_API_TOKEN`
- or call API with header:
```bash
curl -X POST "http://localhost:8000/api/v1/sync/all?symbol=BTCUSDT&limit=100" \
  -H "X-API-Token: <your-token>"
```

### C) Rate limit 429
Wait `SYNC_MIN_INTERVAL_SECONDS` before retrying same endpoint/actor.

---

## 4) Token rotation

1. Update `SYNC_API_TOKEN` in `backend/.env`
2. Restart backend
3. Update UI token input (or automation secret)
4. Validate with one sync call

---

## 5) Quick validation checklist (10 min)

- [ ] `APP_READ_ONLY=false` + good token => sync OK
- [ ] `APP_READ_ONLY=true` => sync blocked (403)
- [ ] bad token => unauthorized (401)
- [ ] `GET /api/v1/audit/summary?window=30d` responds
- [ ] `GET /api/v1/sync/events?limit=20&offset=0` responds
- [ ] audit CSV export works
- [ ] sync events CSV export works

For full manual QA, use `QA_CHECKLIST_V1.md`.

Automated smoke (API):
```bash
cd /home/guts/.openclaw/workspace/trading-dashboard
chmod +x scripts/smoke_api_v1.sh
BASE_URL=http://localhost:8000 SYNC_TOKEN='<token-if-needed>' ./scripts/smoke_api_v1.sh
```

Metrics sanity (V1.1 risk/perf consistency):
```bash
cd /home/guts/.openclaw/workspace/trading-dashboard
chmod +x scripts/qa_metrics_sanity_v1_1.sh
BASE_URL=http://localhost:8000 ./scripts/qa_metrics_sanity_v1_1.sh
```

---

## 6) Backup / restore (SQLite default)

From `trading-dashboard/backend`:
```bash
cp trading.db trading.db.bak.$(date +%Y%m%d_%H%M%S)
```

Restore:
```bash
cp trading.db.bak.<timestamp> trading.db
```

Stop backend during restore to avoid file lock/corruption.
