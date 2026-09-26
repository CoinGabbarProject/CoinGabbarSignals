# CoinGabbarSignals

Crypto trade-signal dashboard: a static frontend (`index.html`) showing a
scored, rule-based signal card (setup score, entry/SL/TP, market/technical/
derivatives/risk breakdown, and after-trade performance stats), backed by a
small Express + MongoDB API for live market data and (optionally) the
existing content/admin backend.

## Structure

```
index.html            Signals dashboard page (the only frontend page)
assets/
  css/style.css        All page styling
  js/app.js             Canvas candlestick chart + live market ticker
favicon.svg            Brand mark
api/
  index.js             Vercel serverless entry -> backend/server.js
backend/               Express API (auth, articles, crypto, rankings, ads…)
vercel.json            Rewrites /api/* to the serverless function
package.json           Root deps (mirrors backend/package.json for Vercel)
```

## Running locally

Frontend only (static):

```bash
npx serve .
# or: python3 -m http.server 8080
```

Full stack with the API:

```bash
cd backend
npm install
cp .env.example .env   # fill in MONGO_URI, JWT_SECRET, etc.
npm run dev
```

The dashboard's "Market Overview" widget calls `GET /api/crypto/markets` and
`GET /api/crypto/global` for live BTC/ETH prices and total market cap; if the
API isn't reachable (e.g. no `MONGO_URI` configured yet) it just keeps the
static demo figures already in the markup, so the page always renders.

### CoinGecko API key

These crypto endpoints work without a key (CoinGecko's public tier), but a
free "Demo" key raises the rate limit a lot. Put yours in `backend/.env` as
`COINGECKO_API_KEY=...` — **never** in frontend code or a committed file.
The server attaches it as an `x-cg-demo-api-key` header. `.env` is already
git-ignored; only `backend/.env.example` (placeholders only) is committed.

## Deploying

This is set up for Vercel: `vercel.json` serves `index.html`/`assets/*`
statically and rewrites `/api/*` to `api/index.js`, which forwards requests
into the Express app in `backend/server.js`. Set the environment variables
from `backend/.env.example` in your Vercel project before deploying.
