# CoinGabbarSignals API

Backend that serves the data shown on the BTC/USDT signal dashboard: setup
score, entry/SL/TP, market/technical/derivatives/risk breakdowns, market
overview ticker, and after-trade performance stats.

## Setup

```bash
cd backend
npm install
npm start        # runs on http://localhost:4000
```

For auto-reload while developing:

```bash
npm run dev
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/signals` | List all signals (summary) |
| GET | `/api/signals/:pairSlug` | Full detail for one signal (e.g. `btc-usdt`) |
| GET | `/api/signals/:pairSlug/after-trade` | Performance / after-trade analysis for a signal |
| GET | `/api/market-overview` | BTC/ETH/Total Cap/BTC Dominance ticker |

### Example

```bash
curl http://localhost:4000/api/signals/btc-usdt
```

```json
{
  "id": "sig_btcusdt_001",
  "pair": "BTC/USDT",
  "direction": "LONG",
  "status": "ACTIVE",
  "setupScore": 89,
  "entryZone": { "min": 65000, "max": 65300 },
  "stopLoss": 64500,
  "takeProfit": [
    { "level": "TP1", "price": 66000 },
    { "level": "TP2", "price": 67000 },
    { "level": "TP3", "price": 68200 }
  ],
  "...": "..."
}
```

## Connecting the frontend

CORS is enabled for all origins. From the dashboard HTML/JS, fetch data like:

```js
const res = await fetch('http://localhost:4000/api/signals/btc-usdt');
const signal = await res.json();
```

## Next steps for production

- Replace the in-memory `signals` object with a real database (Postgres/Mongo).
- Add authentication if signals should be gated behind a login/subscription.
- Add a cron/worker that recalculates `setupScore`, `market`, `technical`,
  etc. from live exchange data instead of static values.
- Add pagination to `/api/signals` once there are many signals.

