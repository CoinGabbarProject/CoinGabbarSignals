# Architecture
Market Data → Validation → Normalization → Candles → Indicators → Structure/SR → Liquidity/Order Book/Derivatives/News/Context → MTF → Direction → Entry → SL → TP → R:R → Risk → Score → Critical Override → Publish → Lifecycle → Performance.

Backend boundaries: routes/controllers → services → engines → providers → database. Frontend consumes data models and shared API calculation services; trading logic is not embedded in UI.