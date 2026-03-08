#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
API_URL="${BASE_URL}/api/v1"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1"; exit 1; }
}

need_cmd curl
need_cmd python3

check_window() {
  local w="$1"
  echo "[qa] checking window=${w}"

  local payload
  payload=$(curl -sS "${API_URL}/stats/overview?window=${w}")

  python3 - <<'PY' "$w" "$payload"
import json, sys
w = sys.argv[1]
p = json.loads(sys.argv[2])

required = [
  "current_drawdown_pct", "max_drawdown_pct", "current_dd_duration_hours", "max_dd_duration_hours",
  "current_loss_streak", "max_consecutive_losses", "profit_factor", "expectancy",
  "avg_win_loss_ratio", "net_pnl_after_fees", "data_quality"
]
missing = [k for k in required if k not in p]
if missing:
    print(f"[FAIL] window={w} missing keys: {missing}")
    sys.exit(1)

if p["current_drawdown_pct"] < 0 or p["max_drawdown_pct"] < 0:
    print(f"[FAIL] window={w} drawdown negative")
    sys.exit(1)

if p["current_loss_streak"] < 0 or p["max_consecutive_losses"] < 0:
    print(f"[FAIL] window={w} streak negative")
    sys.exit(1)

if p["current_loss_streak"] > p["max_consecutive_losses"]:
    print(f"[FAIL] window={w} current streak > max streak")
    sys.exit(1)

if p["current_dd_duration_hours"] < 0 or p["max_dd_duration_hours"] < 0:
    print(f"[FAIL] window={w} dd duration negative")
    sys.exit(1)

if p["current_dd_duration_hours"] > p["max_dd_duration_hours"] + 1e-9:
    print(f"[FAIL] window={w} current dd duration > max dd duration")
    sys.exit(1)

q = p.get("data_quality") or {}
for k in ["avg_r_loss", "avg_r_by_trade", "exit_distribution", "funding_fees"]:
    if k not in q:
        print(f"[FAIL] window={w} data_quality missing {k}")
        sys.exit(1)

print(f"[OK] window={w} sanity passed")
PY
}

check_window 24h
check_window 7d
check_window 30d

echo "[qa] metrics sanity checks passed for 24h/7d/30d"
