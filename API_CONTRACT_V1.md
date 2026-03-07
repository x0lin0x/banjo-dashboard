# API_CONTRACT_V1.md — Trading Dashboard

Statut: Canonique v1 (MVP)
Date: 2026-03-07
Base: `/api/v1`

## Conventions
- Timezone: UTC ISO-8601
- Pagination: `limit` + `cursor` (v2), MVP: `limit` simple
- Numeric: JSON number (pas string sauf nécessité extrême)
- Error format:
```json
{ "error": { "code": "STRING", "message": "human readable", "details": {} } }
```

## 1) Health
### GET `/health`
Response:
```json
{ "status": "ok", "service": "Trading Dashboard API" }
```

## 2) Overview
### GET `/stats/overview?window=24h|7d|30d`
Response:
```json
{
  "total_trades": 1234,
  "total_positions": 6,
  "total_realized_pnl": 1250.45,
  "total_unrealized_pnl": -42.10,
  "equity": 10452.20,
  "max_drawdown_pct": 12.4,
  "updated_at": "2026-03-07T05:41:00Z"
}
```

## 3) Trades
### GET `/trades?limit=100&symbol=BTCUSDT`
Response:
```json
{
  "trades": [
    {
      "id": 1,
      "binance_trade_id": "123456",
      "symbol": "BTCUSDT",
      "side": "BUY",
      "price": 91234.1,
      "qty": 0.01,
      "commission": 0.12,
      "realized_pnl": 4.21,
      "executed_at": "2026-03-07T05:30:00Z",
      "order_id": "987654",
      "decision_id": null,
      "signal_id": null
    }
  ]
}
```

## 4) Positions
### GET `/positions`
Response:
```json
{
  "positions": [
    {
      "id": 2,
      "symbol": "ETHUSDT",
      "side": "LONG",
      "position_amt": 0.5,
      "entry_price": 2400.0,
      "mark_price": 2421.4,
      "liquidation_price": 1870.3,
      "leverage": 5,
      "notional_usd": 1210.7,
      "unrealized_pnl": 10.7,
      "updated_at": "2026-03-07T05:39:00Z"
    }
  ]
}
```

## 5) Risk
### GET `/risk/exposure`
Response:
```json
{
  "gross_long_usd": 12000,
  "gross_short_usd": 8000,
  "net_usd": 4000,
  "top_symbol_share_pct": 28.2,
  "leverage_weighted": 4.7,
  "caps": {
    "max_gross_usd": 30000,
    "max_symbol_share_pct": 35
  }
}
```

## 6) Sync (ingestion)
### POST `/sync/trades?symbol=BTCUSDT&limit=1000`
### POST `/sync/positions`
### POST `/sync/all?symbol=BTCUSDT&limit=1000`
### POST `/sync/scan-all-symbols?limit=1000`
Response type:
```json
{ "status": "ok", "inserted": 120, "updated": 6 }
```

## 7) Diagnostics
### GET `/diagnostics/connectors`
Response:
```json
{
  "binance": { "status": "ok", "last_success": "2026-03-07T05:40:00Z" },
  "db": { "status": "ok", "latency_ms": 5 }
}
```

### GET `/diagnostics/jobs`
Response:
```json
{
  "jobs": [
    { "name": "sync_positions", "last_run": "2026-03-07T05:40:00Z", "status": "ok" }
  ]
}
```

## 8) Notes implémentation immédiate
- `/trades` et `/positions` déjà ajoutés en MVP.
- Étape suivante: enrichir payloads (side position, liquidation, notional, IDs décisionnels).
- Ajouter routes risk/diagnostics en S1.
