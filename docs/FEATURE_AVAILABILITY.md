# Feature Availability Matrix

This dashboard supports two modes:

1. **API-only** (default)
2. **API + Bot events** (optional advanced mode)

The product must remain fully usable in API-only mode.

## A) Core Dashboard

| Capability | API-only | API + Bot events |
|---|---:|---:|
| Positions / exposure | ✅ exact | ✅ exact |
| Trades history | ✅ exact (exchange fills/orders) | ✅ exact |
| Realized / unrealized PnL | ✅ exact | ✅ exact |
| Drawdown metrics | ✅ usable (can be proxy on sparse data) | ✅ improved |
| Fees / funding metrics | ✅ exact-window when available | ✅ exact-window |

## B) Execution & Quality

| Capability | API-only | API + Bot events |
|---|---:|---:|
| Execution events list | ⚠️ partial | ✅ exact |
| Error/missed tracking | ⚠️ partial | ✅ exact |
| Signal->execution latency | ⚠️ limited proxy | ✅ exact |

## C) Trade Analytics

| Capability | API-only | API + Bot events |
|---|---:|---:|
| Exit distribution | ⚠️ proxy fallback | ✅ exact |
| Exit coverage | ✅ (exact/proxy coverage shown) | ✅ (higher exact coverage) |
| Expectancy quality | ✅ usable | ✅ stronger |

## D) Product Rules

- API-only mode is **first-class** and must stay easy/no-code.
- Bot-events mode is **optional** and must improve precision without being required.
- UI should always expose metric quality/source (exact/snapshots/proxy/unavailable).
- Pricing can differentiate by precision and telemetry depth, not by basic accessibility.
