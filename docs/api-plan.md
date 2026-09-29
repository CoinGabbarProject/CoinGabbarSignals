# CoinGabbarSignals — API Plan

Base path `/api/v1`. JSON over HTTPS. Stateless server; sessions via httpOnly cookie (`SESSION_SECRET`).

## Conventions
- **Mode**: `X-Data-Mode: DEMO|PAPER|LIVE` (default = server `DATA_MODE`). Not in `ALLOWED_DATA_MODES` → `403 mode_not_allowed`. Every payload echoes `dataMode`.
- **Errors**: `{ "error": { "code": "snake_case", "message": "…" } }` (type `ApiError` in `/shared/api.ts`).
- **Pagination**: cursor based — `?limit=50&cursor=…` → `{ items, nextCursor }`.
- **Time**: ISO-8601 UTC. **Numbers**: decimal strings for prices.
- **Versioning**: breaking changes → `/api/v2`. Additive changes allowed in v1.
- **Rate limits**: per IP/session; `429` with `Retry-After`.
- **CORS**: only `CORS_ORIGINS`.

## Endpoints
| Status | Method & path | Purpose |
|---|---|---|
| ✅ built | `GET /health` | liveness |
| ✅ built | `GET /meta` | env, default mode, allowed modes |
| planned | `GET /instruments` | tradable instruments |
| planned | `GET /signals` | filter: status, instrument, strategy, timeframe, minConfidence |
| planned | `GET /signals/:id` | signal + events + outcome |
| planned | `GET /signals/stream` | SSE: `signal.created`, `signal.updated`, `signal.closed` |
| planned | `GET /strategies` | active strategies + versions |
| planned | `GET /performance` | win rate, avg R, drawdown by strategy/period |
| planned | `GET /candles` | OHLCV for charting |
| planned | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | session |
| planned | `GET/POST/DELETE /watchlists` | user lists |
| planned | `GET/POST/PATCH/DELETE /alerts` | alert rules |
| planned | `POST /paper/accounts`, `GET /paper/positions` | PAPER mode only (`409` otherwise) |
| planned | `GET /admin/engine/status` | admin role |

## Signal resource (draft)
```json
{
  "id": "…", "dataMode": "PAPER", "instrument": "BTC-USDT", "timeframe": "1h",
  "side": "long", "entry": "64250.5", "stopLoss": "63800", "takeProfit": ["64900","65500"],
  "confidence": 78, "strategy": { "key": "trend-pullback", "version": 3 },
  "status": "open", "createdAt": "…", "expiresAt": "…", "rationale": { }
}
```

## Security
Input validation with zod on every route; body limit 100 kB; `x-powered-by` disabled; helmet-style headers and auth middleware added with auth part; no secrets in responses; audit-log all admin/LIVE-affecting actions.
