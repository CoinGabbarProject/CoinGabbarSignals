# Indicator audit

Based on reading the code (not on test runs). Default engine: `CORE4=true`, `CORE_INDICATORS=ema,rsi,smc,liq`.

## Active in the CORE4 score
- EMA20 / EMA50: sets direction (EMA20 above EMA50 = LONG) and scores up to 30 points.
- RSI14: up to 20 points. RSI above 75 is a failure in CORE4.
- SMC (BOS/CHoCH, order blocks, FVG, sweeps, premium/discount): up to 30 points.
- Liquidation clusters: up to 20 points.

## Used outside the score
- ATR: the overextension check (more than 2 ATR from EMA20 is a hard failure), stop sizing.
- Support/resistance levels: stop and target placement.

## Calculated but with no effect on the CORE4 score or gates
SMA200, MACD, Bollinger, VWAP, ADX/DI, StochRSI, OBV, Fib, candle confirmation, the confirmation timeframe, daily higher-timeframe, and all derivatives (funding, open interest, long/short, taker, top traders, book imbalance).
They do count in the full engine (profiles B and C).

## Not implemented
Standalone relative volume, an absolute depth or slippage gate, historical derivatives, historical liquidations.

## Formula status (code read, not test-verified)
RSI, ATR, ADX (Wilder), EMA, MACD and Bollinger look correct. Closed-candle filtering, confirmation-timeframe alignment and SMC pivot confirmation have no look-ahead on reading. VWAP resets every UTC day on every timeframe, so it is not meaningful on 4H and 1D.
