# CoinGabbarSignals Parts 21–30
Implemented engines are intentionally contextual and deterministic.

- 21 Liquidity: equal highs/lows, previous day/week levels, breakout zones and chart-ready ranges.
- 22 Order book: volumes, spread, midpoint, bounded imbalance, concentration and abnormal conditions.
- 23 Derivatives: OI, funding, long/short, liquidations, basis and four price/OI combinations. Interpretations are explicitly possible, not guaranteed.
- 24 Market context: BTC/ETH trend, dominance, market cap, alt condition, Fear & Greed, volatility and regime.
- 25 MTF: normalized -1/0/+1 directional points with conflict visibility.
- 26 News: source/timestamp required and unverified events cannot be treated as verified signal evidence.
- 27 Scoring: 100-point weighted setup-strength model across the eight requested categories.
- 28 Critical override: any critical failure produces `NO_TRADE`, regardless of score.
- 29 Direction: LONG/SHORT/WAIT/NO_TRADE is separate from setup score and includes supporting/conflicting/invalidating factors.
- 30 Entry: ideal/min/max, breakout/pullback, trigger, expiry, maximum chase and do-not-chase state.
