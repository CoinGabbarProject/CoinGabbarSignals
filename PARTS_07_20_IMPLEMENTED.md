# CoinGabbarSignals Parts 07–20 — Implemented

This package contains the actual implementation, not Claude AI prompts.

## Part 07
New `Sidebar` navigation with:
- Latest Signals, Signal History, Performance, Backtesting, Watchlist, Market Analysis, Academy, Tools, Alerts, Settings
- active/hover/collapsed states
- mobile drawer + scrim
- notification badges
- Escape and `[` keyboard controls
- semantic navigation and accessible labels

## Part 08
Reusable data-driven component library in `src/components/ui`.
No market/provider data is embedded in reusable components.
Documentation: `docs/components.md`.

## Part 09
Backend layers:
`API → Controller → Service → Calculation Engine → Signal Engine → Data Provider → Database`.
Services and structured HTTP logging are separated.

## Part 10
PostgreSQL-oriented schema and migration in `server/db`.
Includes entities requested, foreign keys, indexes, timestamps, status fields, and an immutability trigger for closed/expired/cancelled signals. Corrections should be appended through audit/event workflow.

## Parts 11–12
Provider interface + mock adapter and normalization contracts.
Every provider response includes source, exchange, symbol, timestamp, timeframe, data quality and latency.

## Part 13
UTC candle aggregation, completed-candle filtering, ordering and gap detection.

## Parts 14–17
Deterministic SMA/EMA, Wilder RSI, MACD, Bollinger Bands, ATR and VWAP calculations with structured output.

## Part 18
Volume SMA, relative volume, spike/contraction/unusual volume and momentum acceleration. Volume is contextual and not a standalone trade trigger.

## Part 19
Confirmed, non-repainting swing structure and HH/HL/LH/LL events.

## Part 20
Merged support/resistance levels with strength, touch count, timeframe, reaction time and source methods.

## Verification note
The source has been statically reviewed, but dependency installation could not finish in this execution environment, so `npm test`, `npm run typecheck`, and production build could not be fully executed here.
