# CoinGabbarSignals — Signal Engine

Runs on the server. Pure, deterministic core; I/O at the edges. Not implemented in Part 01.

## Pipeline (per tick, per instrument × timeframe)
1. **Ingest** – `MarketDataProvider` returns closed candles. Only *closed* candles are evaluated (no repainting).
2. **Normalize** – validate, dedupe, fill gaps, persist to `candles` (mode-scoped).
3. **Features** – indicators (EMA, RSI, ATR, volume z-score, structure/levels) computed once and shared.
4. **Strategies** – each versioned strategy is a pure function `(features, params) → Candidate | null`.
5. **Risk shaping** – derive entry, stop (ATR-based), targets; reject if R:R < configured minimum.
6. **Scoring** – confidence 0–100 = weighted blend of trend alignment, momentum, volume confirmation, volatility regime, multi-timeframe agreement. Weights live in `strategy_versions.params`.
7. **Filters** – min confidence, liquidity floor, spread/volatility sanity, cooldown per (instrument, strategy), max concurrent open signals.
8. **Dedupe** – `dedupe_key = hash(instrument, strategy_version, timeframe, side, candle_open_time)`; unique per mode → idempotent re-runs.
9. **Publish** – insert `signals` + `signal_events(created)`; broadcast on SSE.
10. **Lifecycle** – each tick evaluates open signals against new candles → `tp_hit`, `sl_hit`, `expired`; writes `signal_outcomes` (R-multiple, MFE/MAE).

## Interfaces
```ts
interface MarketDataProvider { getCandles(q): Promise<Candle[]>; }        // synthetic | real
interface Strategy { key: string; version: number; evaluate(f: Features, p: Params): Candidate | null; }
interface SignalStore { insertIfNew(s: Signal): Promise<boolean>; listOpen(mode): Promise<Signal[]>; }
```

## Mode behaviour
| Mode | Provider | Store | Notes |
|---|---|---|---|
| DEMO | seeded synthetic generator (same seed ⇒ same signals) | in-memory or DB | golden-file testable |
| PAPER | real | Postgres | outcomes also feed paper positions |
| LIVE | real | Postgres | extra guards: provider health check, staleness cutoff, kill switch |

## Safeguards
- **Kill switch**: `engine_paused` flag halts publishing in any mode without redeploy.
- **Staleness**: no signals if latest candle older than 2× timeframe.
- **Isolation**: engine instances are keyed by mode; one mode's failure cannot block another.
- **Explainability**: every signal stores `rationale` (inputs, sub-scores) for audit.
- **Disclaimer**: signals are informational, not financial advice — surfaced in UI and API meta.

## Testing plan
Unit tests for indicators and each strategy with fixture candles; DEMO golden tests for full pipeline determinism; property tests for R:R and dedupe idempotency; backtest harness reuses the same pure core.
