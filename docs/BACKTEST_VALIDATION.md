# Backtest and validation

Route: `/engine/backtest?key=BACKTEST_KEY&days=30&tf=1H`
Options: `symbols`, `minScore`, `cost` (percent round trip), `hold` (bars), `btc=0|1`, `cluster`, `profile=A|B`, `stop=fixed|staged`, `trail` (percent), `funding` (percent per 8h, assumption), `format=json`.

## What it does
Walks closed candles, runs the same `buildSignal` as live, enters at the next candle open if inside the entry zone, and plays the trade forward. The stop is checked before targets in the same candle. Costs are charged once per round trip.

## Parity with live
- `stop=fixed` (default): the stop never moves. `stop=staged`: entry after TP1, TP1 after TP2, optional percent trail. A moved stop applies from the next candle.
- Funding is an assumption you supply. It is only charged, never credited.
- Not replayed: derivatives, liquidations, order book, news, daily higher-timeframe filter, exit-if-weak rule, live-price entry check, hard filters.
- Fills: next-candle open inside the zone. Live counts any touch of the zone.
- Max open per direction: 3 here, 5 live by default.

## Validation harness
The report ends with a validation section:
- Chronological split by entry time: train 60%, validation 20%, test 20%.
- 95% bootstrap interval of average R per segment (seeded, repeatable).
- Baselines from the same run with minScore 0: all signals, and signals below minScore.
- By-month slices (a time proxy, not true market regimes).

## Verdict
- PASS: the test interval is above 0, validation average R is positive, and the score beats the low-score baseline.
- FAIL: the whole test interval is below 0.
- INCONCLUSIVE: anything else, including fewer than 30 trades in validation or test.

Use train and validation to choose settings. Look at the test segment once.

## Limits
Trades overlap in time, so the intervals are optimistic. Past results do not guarantee future results. The route is protected only by a `key` query parameter.
