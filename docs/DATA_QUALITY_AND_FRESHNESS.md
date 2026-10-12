# Data quality and freshness

## Candles
Only closed candles are used. The scanner fetches 300 candles on the primary timeframe, plus the confirmation timeframe.

## `dataQuality.status`
- FRESH: all selected data present, last candle recent.
- PARTIAL: some inputs are listed as unavailable (full engine only; CORE4 does not report missing SMC or liquidation data yet).
- DELAYED: last candle older than 2 candles. A tradeable result on stale data becomes NO_TRADE.
- UNAVAILABLE: indicators or candles missing.

## Caches
Daily higher-timeframe candles: 30 minutes. Liquidation events: 60 seconds. The tracker runs every 10 seconds.

## Optional hard filters (off by default)
`HARD_FILTERS=true` enables them. They run live only, right before a signal is accepted.
- `MAX_SPREAD_PCT` (default 0.1): (ask - bid) / mid.
- `MIN_VOLUME_24H_USD` (default 0 = off).
- `MAX_DATA_AGE_MS` (default 15000): age of the market snapshot.
- Missing snapshot, spread or volume blocks the signal (fail closed). A 24h volume of 0 counts as missing, because the snapshot reports 0 when the ticker call fails.
- No absolute depth or slippage gate: OKX book sizes are in contracts, not USD.

## Determinism
Scoring uses the injected `now`, not the wall clock. Identical candles, config and `now` give an identical signal. The hard filters and the live-price check use real time and live data and are not deterministic.
