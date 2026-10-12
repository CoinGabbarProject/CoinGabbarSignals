# Strategy profiles

Select the live profile with `STRATEGY_PROFILE=A|B|C` (default A). An unknown value falls back to A. Every signal stores `strategy.version`.

| Profile | Version | What it is | Backtestable |
|---|---|---|---|
| A | `core4-v1` | The current default: CORE4 score, as configured by env | yes |
| B | `full-v1` | Full engine with hard gates (ADX, higher timeframe, candle confirmation), no Fib | yes |
| C | `full-deriv-v1` | Profile B, and no trade unless funding, open interest, long/short and book imbalance are all real numbers | no |

## Rules
- Profile A changes nothing compared with the code before profiles existed (a test pins this).
- Profile C is disabled in the backtest because no historical derivatives data exists. `profile=C` returns an error.
- Profile C live: if any derivatives field is missing, the signal becomes NO_TRADE with the reason stated.
- Changing scoring, gates or planning for a profile means a new version string, and the pinned tests change in the same commit.

## Shadow score (experimental)
`SHADOW_SCORE=true` adds `shadow` to each signal: the CORE4 parts, but missing SMC or liquidation data counts 0 instead of the neutral midpoint. It never affects a decision. It exists only for the default core `ema,rsi,smc,liq`. The weights are a placeholder, not a validated model.
