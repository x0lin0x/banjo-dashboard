#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/guts/clawd/trading-dashboard"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/new-dashboard"

echo "[1/2] Starting backend on :8000"
if [ -d "$BACKEND_DIR/.venv" ]; then
  # shellcheck disable=SC1091
  source "$BACKEND_DIR/.venv/bin/activate"
fi

( cd "$BACKEND_DIR" && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload ) &
BACKEND_PID=$!

echo "[2/2] Starting new-dashboard on :5173"
( cd "$FRONTEND_DIR" && npm run dev -- --host 0.0.0.0 --port 5173 ) &
FRONTEND_PID=$!

cleanup() {
  echo "Stopping services..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Backend:  http://127.0.0.1:8000/docs"
echo "Frontend: http://127.0.0.1:5173"
wait
