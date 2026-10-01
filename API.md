# API
`GET /api/v1/health` health. `POST /api/v1/tools/position-size`, `/risk-reward`, `/stop-loss`, `/take-profit`, `/liquidation` use the same backend calculation engines. Admin routes require authenticated admin role. Signal and market routes remain under `/api/v1`.

## Signal engine (`/api/v1/engine/*`)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/engine/signals` | login | Latest result per symbol (LONG/SHORT/WAIT/NO_TRADE). Query: `symbol`, `direction`, `limit` (1-100). |
| GET | `/engine/signals/history` | login | Emitted LONG/SHORT signals. Query: `symbol`, `status` (ACTIVE/CANCELLED/EXPIRED), `limit`. |
| GET | `/engine/status` | admin | Scheduler state, next run, last run summary. |
| POST | `/engine/scan` | admin | Run a scan now. Optional body `{ "symbols": ["BTCUSDT"], "timeframe": "1H" }`. 409 if a scan is already running. |

Env: `AUTO_SCAN_ENABLED`, `SCAN_INTERVAL_MS` (min 60000), `SCAN_SYMBOLS`, `SCAN_TIMEFRAME`, `SCAN_MIN_SCORE`, `SCAN_CONCURRENCY`, `BINANCE_SPOT_URL`, `BINANCE_FUTURES_URL`. See `.env.example`.
