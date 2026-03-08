#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
API_URL="${BASE_URL}/api/v1"
SYNC_TOKEN="${SYNC_TOKEN:-}"

echo "[smoke] BASE_URL=${BASE_URL}"

request() {
  local method="$1"
  local url="$2"
  local expected="$3"
  local token_header=()

  if [[ -n "${SYNC_TOKEN}" ]]; then
    token_header=(-H "X-API-Token: ${SYNC_TOKEN}")
  fi

  local code
  code=$(curl -s -o /tmp/smoke_body.txt -w "%{http_code}" -X "$method" "${url}" "${token_header[@]}")

  if [[ "$code" != "$expected" ]]; then
    echo "[FAIL] ${method} ${url} -> expected ${expected}, got ${code}"
    echo "Body:"
    cat /tmp/smoke_body.txt || true
    exit 1
  fi

  echo "[OK]   ${method} ${url} -> ${code}"
}

# Core health/data
request GET "${BASE_URL}/health" 200
request GET "${API_URL}/diagnostics/connectors" 200
request GET "${API_URL}/diagnostics/db-writable" 200
request GET "${API_URL}/stats/overview?window=30d" 200
request GET "${API_URL}/stats/equity?window=30d" 200
request GET "${API_URL}/risk/exposure" 200
request GET "${API_URL}/trades?limit=25&offset=0&window=30d" 200
request GET "${API_URL}/positions" 200
request GET "${API_URL}/audit/summary?window=30d" 200
request GET "${API_URL}/audit/trades?window=30d&limit=25&offset=0" 200
request GET "${API_URL}/sync/events?limit=20&offset=0" 200
request GET "${API_URL}/execution/summary?window=30d" 200
request GET "${API_URL}/execution/events?limit=20&offset=0" 200
request GET "${API_URL}/execution/errors-timeseries?window=30d" 200
request GET "${API_URL}/funding/trend?window=30d" 200
request GET "${API_URL}/audit/trades.csv?window=30d" 200
request GET "${API_URL}/sync/events.csv" 200

# Optional sync + execution ingest check with token if provided
if [[ -n "${SYNC_TOKEN}" ]]; then
  echo "[smoke] SYNC_TOKEN provided -> checking sync endpoint"
  code=$(curl -s -o /tmp/smoke_sync.txt -w "%{http_code}" -X POST "${API_URL}/sync/all?symbol=BTCUSDT&limit=10" -H "X-API-Token: ${SYNC_TOKEN}")
  if [[ "$code" == "200" || "$code" == "403" || "$code" == "429" || "$code" == "503" ]]; then
    echo "[OK]   POST ${API_URL}/sync/all -> ${code} (accepted for env-specific policy)"
  else
    echo "[FAIL] POST ${API_URL}/sync/all unexpected code ${code}"
    cat /tmp/smoke_sync.txt || true
    exit 1
  fi

  echo "[smoke] checking execution event ingest"
  code=$(curl -s -o /tmp/smoke_exec_ingest.txt -w "%{http_code}" -X POST "${API_URL}/execution/events" \
    -H "X-API-Token: ${SYNC_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"source":"smoke","event_type":"smoke_test","status":"ok","latency_ms":1}')
  if [[ "$code" == "200" ]]; then
    echo "[OK]   POST ${API_URL}/execution/events -> ${code}"
  else
    echo "[FAIL] POST ${API_URL}/execution/events unexpected code ${code}"
    cat /tmp/smoke_exec_ingest.txt || true
    exit 1
  fi
fi

echo "[smoke] All checks passed."
