# Bot Events Integration (Optional)

This integration is optional. The dashboard works without it (API-only mode).

When enabled, bot events improve analytics precision (exit reasons, latency, missed/reject telemetry).

## Endpoints

- `POST /api/v1/execution/events`
- `POST /api/v1/health/heartbeat`

Headers:
- `X-API-Token: <SYNC_API_TOKEN>`
- `Content-Type: application/json`

## Payload

```json
{
  "source": "bot-runtime",
  "symbol": "BTCUSDT",
  "signal_id": "sig-123",
  "decision_id": "dec-456",
  "event_type": "order_closed",
  "status": "ok",
  "latency_ms": 320,
  "error_code": null,
  "error_message": null,
  "exit_reason": "take_profit",
  "order_id": "8670810173",
  "binance_trade_id": "425994202"
}
```

## Exit Reason Taxonomy

Normalized values used by backend:
- `tp`
- `sl`
- `manual`
- `opposite`
- `timeout`
- `other`

Accepted aliases are normalized automatically:
- `take_profit`, `takeprofit` -> `tp`
- `stop_loss`, `stoploss` -> `sl`
- `manual_close`, `user_close` -> `manual`
- `reverse`, `flip` -> `opposite`
- `time`, `expiry` -> `timeout`

## Behavior

- Event is stored in `execution_events`.
- If `exit_reason` is provided and trade identity can be matched (`binance_trade_id`, `order_id`, or signal/decision context), matching trades get exact `exit_reason` updated.

## Minimal curl example

```bash
curl -X POST "http://localhost:8000/api/v1/execution/events" \
  -H "X-API-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "source":"bot-runtime",
    "symbol":"BTCUSDT",
    "event_type":"order_closed",
    "status":"ok",
    "latency_ms":320,
    "exit_reason":"take_profit",
    "order_id":"8670810173"
  }'
```

## Heartbeat payload example

```json
{
  "source": "bot-runtime",
  "status": "ok",
  "latency_ms": 42,
  "note": "main loop alive"
}
```

curl:

```bash
curl -X POST "http://localhost:8000/api/v1/health/heartbeat" \
  -H "X-API-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{"source":"bot-runtime","status":"ok","latency_ms":42}'
```

## Recommendation

Emit one event at least for:
- signal generated
- order accepted/rejected
- position closed (with exit_reason)
- api error/missed execution
- periodic heartbeat (30-60s)

This gives the best exact coverage while keeping API-only mode available for all users.
