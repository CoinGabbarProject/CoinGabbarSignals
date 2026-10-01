# Signal Engine
Setup Score is a 100-point strength measure only. It is not accuracy, win probability, profit probability or guaranteed return. Critical failure always overrides score and produces NO_TRADE.

## Signal builder (server/engine/signalBuilder.ts)
Decision order, first match wins: criticalFailure -> NO_TRADE; side NEUTRAL -> WAIT; score < minScore (default 65) -> WAIT; levels invalid or TP1 room < 1R -> NO_TRADE; weighted R:R < 1.5 -> NO_TRADE; else LONG/SHORT.
Entry = last close (ideal) with a zone of 0.3 ATR on the pullback side and 0.1 ATR on the chase side. Stop = beyond the nearest structural level + 0.25 ATR buffer when that is 1-2.5 ATR away, otherwise 1.5 ATR. TP1/2/3 = 1.5R / 2.5R / 4R; TP1 is capped just before the next opposing level. Weighted R:R uses 50/30/20 exit shares. R:R is theoretical only.

