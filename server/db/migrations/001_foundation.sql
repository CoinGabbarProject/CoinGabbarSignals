-- CoinGabbarSignals Parts 10: immutable signal ledger + analytics foundation
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE signals (id TEXT PRIMARY KEY, symbol TEXT NOT NULL, side TEXT NOT NULL CHECK(side IN ('LONG','SHORT','NO_TRADE')), status TEXT NOT NULL, timeframe TEXT NOT NULL, score NUMERIC(5,2), entry NUMERIC, stop NUMERIC, targets JSONB NOT NULL DEFAULT '[]', rationale TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, closed_at TIMESTAMPTZ);
CREATE TABLE signal_events (id TEXT PRIMARY KEY, signal_id TEXT NOT NULL REFERENCES signals(id), event_type TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE signal_analysis (id TEXT PRIMARY KEY, signal_id TEXT NOT NULL REFERENCES signals(id), analysis JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE signal_scores (id TEXT PRIMARY KEY, signal_id TEXT NOT NULL REFERENCES signals(id), component TEXT NOT NULL, score NUMERIC(6,2) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE signal_targets (id TEXT PRIMARY KEY, signal_id TEXT NOT NULL REFERENCES signals(id), label TEXT NOT NULL, price NUMERIC NOT NULL, hit_at TIMESTAMPTZ);
CREATE TABLE market_snapshots (id TEXT PRIMARY KEY, symbol TEXT NOT NULL, exchange TEXT NOT NULL, timestamp TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL);
CREATE TABLE indicator_snapshots (id TEXT PRIMARY KEY, symbol TEXT NOT NULL, timeframe TEXT NOT NULL, timestamp TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL);
CREATE TABLE watchlists (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE alerts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), symbol TEXT NOT NULL, type TEXT NOT NULL, threshold NUMERIC, enabled BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE alert_events (id TEXT PRIMARY KEY, alert_id TEXT NOT NULL REFERENCES alerts(id), payload JSONB NOT NULL, triggered_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE performance_records (id TEXT PRIMARY KEY, signal_id TEXT NOT NULL REFERENCES signals(id), pnl_r NUMERIC NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE backtests (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), config JSONB NOT NULL, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE backtest_trades (id TEXT PRIMARY KEY, backtest_id TEXT NOT NULL REFERENCES backtests(id), payload JSONB NOT NULL);
CREATE TABLE audit_logs (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE data_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, exchange TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX signals_symbol_status_idx ON signals(symbol,status);
CREATE INDEX signals_created_idx ON signals(created_at DESC);
CREATE INDEX market_snapshots_symbol_time_idx ON market_snapshots(symbol,timestamp DESC);
CREATE INDEX indicator_snapshots_symbol_tf_time_idx ON indicator_snapshots(symbol,timeframe,timestamp DESC);
CREATE INDEX alerts_user_enabled_idx ON alerts(user_id,enabled);
CREATE INDEX signal_events_signal_time_idx ON signal_events(signal_id,created_at);
-- Signal rows are not updated by normal application paths after closure.
-- Corrections append an audit_log + correction event rather than mutating history.


CREATE OR REPLACE FUNCTION prevent_closed_signal_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('CLOSED','EXPIRED','CANCELLED') THEN
    RAISE EXCEPTION 'Closed signal history is immutable; use correction workflow';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER signals_immutable_after_closure BEFORE UPDATE ON signals FOR EACH ROW EXECUTE FUNCTION prevent_closed_signal_mutation();
