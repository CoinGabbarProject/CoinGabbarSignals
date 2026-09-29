# CoinGabbarSignals — Database Plan

Engine: **PostgreSQL 16**. Migrations: forward-only numbered SQL in `/database/migrations` (runner tool to be chosen in a later part). Nothing is migrated in Part 01.

## Conventions
- `id` = UUID v7 (time-ordered). Timestamps `timestamptz`, UTC. Prices/quantities `numeric(38,12)`, never float.
- **`data_mode` enum (`DEMO`,`PAPER`,`LIVE`)** on every mode-scoped table, included in all unique keys and indexes, and always in `WHERE`.
- Soft-delete only where audit matters; signals and outcomes are append-only.
- Row-level access via application layer; DB roles: `app_rw`, `app_ro`, `migrator`.

## Tables

### Reference
| Table | Key columns |
|---|---|
| `instruments` | id, symbol, base, quote, venue, tick_size, active — unique(venue, symbol) |
| `strategies` | id, key (unique), name, description |
| `strategy_versions` | id, strategy_id, version, params jsonb, status (`draft`/`active`/`retired`), created_at — unique(strategy_id, version) |

### Market data
| Table | Key columns |
|---|---|
| `candles` | data_mode, instrument_id, timeframe, open_time, o,h,l,c,v — PK(data_mode, instrument_id, timeframe, open_time); partition by month |

### Signals (core)
| Table | Key columns |
|---|---|
| `signals` | id, data_mode, instrument_id, strategy_version_id, timeframe, side (`long`/`short`), entry, stop_loss, take_profit[], confidence (0–100), rationale jsonb, status, created_at, expires_at, dedupe_key — unique(data_mode, dedupe_key) |
| `signal_events` | id, signal_id, type (`created`/`updated`/`tp_hit`/`sl_hit`/`expired`/`cancelled`), payload jsonb, occurred_at — append-only |
| `signal_outcomes` | signal_id (PK), result, r_multiple, max_favorable, max_adverse, closed_at |
| `engine_runs` | id, data_mode, started_at, finished_at, instruments_scanned, signals_emitted, error |

### Paper trading (PAPER only; enforced by CHECK data_mode='PAPER')
| Table | Key columns |
|---|---|
| `paper_accounts` | id, user_id, base_currency, starting_balance, created_at |
| `paper_positions` | id, account_id, signal_id, entry_price, size, opened_at, closed_at, pnl |

### Users & platform
| Table | Key columns |
|---|---|
| `users` | id, email (citext unique), password_hash / external_id, role, created_at |
| `sessions` | id, user_id, expires_at, created_at |
| `watchlists`, `watchlist_items` | user-scoped instrument lists |
| `alert_rules` | id, user_id, filter jsonb, channel, enabled |
| `audit_log` | id, actor, action, entity, entity_id, data_mode, at, meta jsonb — append-only |

## Indexes (initial)
- `signals(data_mode, status, created_at desc)`
- `signals(data_mode, instrument_id, created_at desc)`
- `signal_events(signal_id, occurred_at)`
- `candles` PK covers range scans; BRIN on `open_time` for partitions.

## Retention
| Data | DEMO | PAPER | LIVE |
|---|---|---|---|
| Candles (≤1h) | 7d | 90d | 2y |
| Signals/outcomes | 30d | 1y | forever |
| Audit log | — | 1y | 7y |

## Environments
Separate database per environment. DEMO seeds run in development only (`database/seeds`). Production migrations run via `migrator` role from CI after staging success; backups + PITR required before LIVE is enabled.
