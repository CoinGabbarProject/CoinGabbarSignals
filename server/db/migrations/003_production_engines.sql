
CREATE TABLE IF NOT EXISTS signal_risk_records (
 id TEXT PRIMARY KEY, signal_id TEXT NOT NULL, stop_loss REAL, stop_method TEXT, tp1 REAL, tp2 REAL, tp3 REAL,
 theoretical_rr_tp1 REAL, theoretical_rr_tp2 REAL, theoretical_rr_tp3 REAL, weighted_rr REAL,
 account_risk_percent REAL, position_size REAL, leverage REAL, estimated_liquidation REAL,
 created_at TEXT NOT NULL, FOREIGN KEY(signal_id) REFERENCES signals(id)
);
CREATE TABLE IF NOT EXISTS signal_events (
 id TEXT PRIMARY KEY, signal_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, reason TEXT,
 created_at TEXT NOT NULL, FOREIGN KEY(signal_id) REFERENCES signals(id)
);
CREATE TABLE IF NOT EXISTS performance_snapshots (
 id TEXT PRIMARY KEY, period_start TEXT NOT NULL, period_end TEXT NOT NULL, config_version TEXT NOT NULL,
 total_signals INTEGER NOT NULL, total_r REAL NOT NULL, win_rate REAL NOT NULL, expectancy REAL NOT NULL,
 profit_factor REAL NOT NULL, max_drawdown REAL NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS backtests (
 id TEXT PRIMARY KEY, configuration_json TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
 status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS backtest_trades (
 id TEXT PRIMARY KEY, backtest_id TEXT NOT NULL, entry_time TEXT NOT NULL, exit_time TEXT NOT NULL,
 direction TEXT NOT NULL, entry REAL NOT NULL, exit REAL NOT NULL, r REAL NOT NULL, pnl REAL NOT NULL,
 fees REAL NOT NULL, slippage REAL NOT NULL, reason TEXT NOT NULL, FOREIGN KEY(backtest_id) REFERENCES backtests(id)
);
CREATE TABLE IF NOT EXISTS notification_preferences (
 user_id TEXT PRIMARY KEY, preferences_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
 old_value TEXT, new_value TEXT, reason TEXT, timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signal_events_signal ON signal_events(signal_id,created_at);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_backtest ON backtest_trades(backtest_id,entry_time);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type,entity_id,timestamp);
-- Closed signal history is append-only. Corrections require an audit event rather than destructive updates.
CREATE TRIGGER IF NOT EXISTS prevent_closed_signal_delete BEFORE DELETE ON signals
WHEN OLD.status='CLOSED' BEGIN SELECT RAISE(ABORT,'closed signals are immutable'); END;
