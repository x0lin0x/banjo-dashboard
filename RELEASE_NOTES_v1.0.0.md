# Trading Dashboard v1.0.0
## Included
- Core dashboard: stats, equity, risk, trades, positions
- Audit endpoints + CSV exports
- Sync events observability + CSV export 
- Sync security model:
- APP_ROLE (operator/viewer)
- APP_READ_ONLY 
- SYNC_API_TOKEN (X-API-Token) 
- rate limiting (SYNC_MIN_INTERVAL_SECONDS)
- V2.3 UX:
- explicit sync lock reasons in diagnostics/UI 
- Ops/docs: 
- backend/.env.example 
- README_OPS.md runbook  
- QA_CHECKLIST_V1.md
- scripts/smoke_api_v1.sh

## Known limits
- No full auth/RBAC user system (env-based role only)  
- In-memory rate limit state   
- SQLite default (Postgres optional via DATABASE_URL)
