# Known limitations

## Open (not fixed, needs a decision or a version bump)
- CORE4 scores missing liquidation and SMC data at a neutral midpoint and leaves `unavailable` empty.
- `SMC_MODE=off` and `LIQ_MODE=off` do nothing while `CORE_INDICATORS` contains `smc` or `liq`. Remove them from `CORE_INDICATORS` instead.
- CORE4 ignores the ADX, higher-timeframe, candle and Fib gates. Profile B applies them.
- Full engine: RSI band rules disagree (70-75 scored, above 72 fails), and several indicators double-count.
- Full engine: the scoring assumes a 2 ATR stop, but the plan may use a structure stop. The Fib stop clamp can sit inside structural invalidation.
- VWAP resets each UTC day on every timeframe.
- Backtest cannot replay derivatives, liquidations, order book or historical spread. Profile C cannot be validly backtested.
- Backtest fills and cluster limits differ from live (see BACKTEST_VALIDATION.md).
- Validation intervals are optimistic (overlapping trades). Regimes are month slices.
- The shadow score weights and the profile definitions are first versions.
- Tracker, scanner and live guards have no automated tests.
- `FINAL_AUDIT.md` describes services and a UI that are not in this repo. Treat it as unreliable.

## Security
- The zip contained a `.env` with database credentials. Rotate them if the zip was shared, and keep `.env` out of version control.
- The backtest route uses a `key` query parameter, which can leak through logs and browser history.

## Addressed in stages 2-8
Strategy version stored on every signal; injected `now` in scoring; characterization tests for CORE4, indicators and trade simulation; opt-in staged stop and funding assumption in the backtest; chronological validation with confidence intervals and an INCONCLUSIVE verdict; optional spread/volume/staleness filters; separate profiles A/B/C; shadow score.

## Verification status
The tests were run only with `tsc` and a stand-in runner in a scratch copy, not with the real `vitest`. Run `npm ci`, `npm test`, typecheck, lint and build before relying on any of this.
