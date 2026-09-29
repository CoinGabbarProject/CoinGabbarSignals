# CoinGabbarSignals Component System

Parts 07–20 introduce a reusable data-driven UI layer. Components accept props and contain no provider-specific or live market data.

## Navigation
`Sidebar` supports active route state, hover, collapsed mode, mobile drawer, notification badges, Escape close, and `[` collapse shortcut.

## UI components
Header, Footer, Sidebar, MarketTicker, SignalCard, SignalStatus, SignalScore, EntryCard, StopLossCard, TakeProfitCard, RiskCard, ChartPanel, AnalysisPanel, TechnicalPanel, DerivativesPanel, ReasoningPanel, HistoryTable, PerformanceCard, AlertCard, WatchlistCard, ToolCard, Modal, Drawer, Tabs, Dropdown, Tooltip, Badge, Skeleton, EmptyState and ErrorState are exported from `src/components/ui`.

## Data flow
Provider → normalization → candle engine → indicator/structure engines → service layer → API → UI.

## Backend
`server/services` contains market, indicator, signal, risk, performance, backtest, alert, watchlist and news services. `server/providers` isolates external market-data adapters. `server/db` contains the initial migration/schema.

## Safety properties
All internal timestamps are UTC epoch milliseconds. Candle aggregation must operate only on completed input candles. Structure events are confirmed only after future candles confirm the pivot. Closed signal history is append-oriented and corrections are represented through audit events.

## Calculation engines
- Candle engine: UTC timestamps, aggregation, incomplete-candle filtering, gap and duplicate detection.
- EMA/SMA: 9/20/50/200 EMA and 20/50/200 SMA.
- RSI: Wilder smoothing, contextual zones only.
- MACD: 12/26/9 crossovers, histogram and zero-line context.
- Bollinger/ATR/VWAP: deterministic formulas with structured context.
- Volume/momentum: relative volume, spike/contraction, confirmation, acceleration and exhaustion context.
- Market structure: confirmed pivots, HH/HL/LH/LL and structure events.
- Support/resistance: merged swing-based levels with touch count, strength and source methods.
