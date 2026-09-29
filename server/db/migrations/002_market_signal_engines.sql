-- Parts 21-30 supporting persistence. Historical signal rows remain immutable after closure.
CREATE TABLE IF NOT EXISTS liquidity_zones (
 id TEXT PRIMARY KEY, signal_id TEXT, price_low NUMERIC NOT NULL, price_high NUMERIC NOT NULL,
 type TEXT NOT NULL, strength NUMERIC NOT NULL, timeframe TEXT NOT NULL, timestamp TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS order_book_snapshots (
 id TEXT PRIMARY KEY, symbol TEXT NOT NULL, source TEXT NOT NULL, timestamp TIMESTAMPTZ NOT NULL,
 bid_volume NUMERIC NOT NULL, ask_volume NUMERIC NOT NULL, spread NUMERIC NOT NULL,
 mid_price NUMERIC NOT NULL, imbalance NUMERIC NOT NULL, large_spread BOOLEAN NOT NULL,
 bid_concentration NUMERIC NOT NULL, ask_concentration NUMERIC NOT NULL
);
CREATE TABLE IF NOT EXISTS derivatives_snapshots (
 id TEXT PRIMARY KEY, symbol TEXT NOT NULL, timestamp TIMESTAMPTZ NOT NULL, price NUMERIC NOT NULL,
 open_interest NUMERIC NOT NULL, oi_change NUMERIC NOT NULL, funding_rate NUMERIC NOT NULL,
 long_short_ratio NUMERIC NOT NULL, long_liquidations NUMERIC NOT NULL, short_liquidations NUMERIC NOT NULL,
 basis NUMERIC NOT NULL, futures_volume NUMERIC NOT NULL, interpretation TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS news_context (
 id TEXT PRIMARY KEY, asset TEXT NOT NULL, headline TEXT NOT NULL, source TEXT NOT NULL,
 timestamp TIMESTAMPTZ NOT NULL, event_type TEXT NOT NULL, importance TEXT NOT NULL,
 sentiment TEXT NOT NULL, verification_status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_liquidity_symbol_time ON liquidity_zones(timeframe,timestamp);
CREATE INDEX IF NOT EXISTS idx_orderbook_symbol_time ON order_book_snapshots(symbol,timestamp);
CREATE INDEX IF NOT EXISTS idx_derivatives_symbol_time ON derivatives_snapshots(symbol,timestamp);
CREATE INDEX IF NOT EXISTS idx_news_asset_time ON news_context(asset,timestamp);
