# Signal scoring and decisions

## CORE4 score (0-100)
Parts are added then scaled to 100 by the parts that are selected in `CORE_INDICATORS`.
- EMA (max 30): 15 for EMA20/50 aligned with the side, +10 if price is on the right side of EMA50, +5 if the EMA gap is at least 0.5 ATR.
- RSI (max 20).
- SMC (max 30), from a points range mapped onto 0-30.
- Liquidation (max 20), from a points range mapped onto 0-20.

Direction comes only from EMA20 vs EMA50. ADX, higher-timeframe, candle and Fib gates are not applied in CORE4.

## Decision order (first match wins)
1. Critical failure (for example price more than 2 ATR from EMA20): NO_TRADE.
2. Neutral direction: WAIT.
3. Score below `minScore` (default 75): WAIT.
4. Trade plan fails (stop, targets or weighted R:R): NO_TRADE.
5. Last candle older than 2 candles: NO_TRADE (data stale).

## Live-only guards after the decision
BTC trend filter (`BTC_FILTER`, default strict), live price must be inside the entry zone, then the optional hard filters (see data quality). A blocked signal becomes WAIT with the reason in `entry.trigger`.

## Known scoring behaviour
- Missing liquidation data scores the neutral midpoint (10 of 20). Missing SMC data scores about 13 of 30. `unavailable` stays empty, so data quality can read FRESH. Tests pin this.
- In the full engine, the RSI rule and the Bollinger/MACD/StochRSI/OBV parts overlap and partly double-count.
- Backtests have no liquidation data, so the liquidity points are constant there. A score of 75 does not mean the same thing live and in a backtest.
