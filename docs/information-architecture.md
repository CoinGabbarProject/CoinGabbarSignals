# CoinGabbarSignals — Information Architecture

> Part 02. Designed from zero. No navigation, labels, page structure or URLs are carried over from the legacy CoinGabbar site. Visual design is out of scope here (see `design-system.md`, later parts).
> Machine-readable source of truth: `shared/routes.ts` and `shared/navigation.ts`. Full route table: `routes.md` (generated).

## 1. Product model
CoinGabbarSignals answers four questions, in this order of importance. The IA is organised around them:

| Question | Areas |
|---|---|
| **What should I look at now?** | Signals, Signal Detail, Market Analysis, Watchlist |
| **Can I trust it?** | Signal History, Performance, Backtesting, Methodology |
| **How do I act on it safely?** | Trading Tools, Alerts, Risk Disclaimer |
| **How do I get better / configure it?** | Academy, Settings |

## 2. Design rules
1. **Signals is home.** `/` redirects to `/signals`. There is no marketing landing inside the app shell.
2. **Two taps to any area, three to any signal.** Depth never exceeds 3 levels below an area root (`/area/section/item`).
3. **Trust is one hop away.** Every signal links to its strategy's Methodology page and its strategy's Performance page.
4. **Risk is never buried.** Risk Disclaimer is in every nav surface, in the footer of every page, and is acknowledged at sign-up and first visit to Signal Detail.
5. **Actions flow forward with context.** Moving from a signal to a tool, alert or backtest pre-fills the form from the signal (via query params); the user never retypes numbers.
6. **URLs are the state.** Filters, timeframe, period and pagination live in the query string so every view is shareable and back-button safe.
7. **Mode is explicit, never implied.** See §6.

## 3. Site map
```
/                          → redirect /signals
├── Signals                /signals
│   └── Signal Detail      /signals/:signalId
├── Signal History         /history
├── Performance            /performance
│   └── Strategies         /performance/strategies
│       └── Strategy       /performance/strategies/:strategyKey
├── Backtesting  🔒        /backtesting
│   ├── New                /backtesting/new
│   └── Run                /backtesting/:runId
├── Watchlist  🔒          /watchlist
│   └── List               /watchlist/:listId
├── Market Analysis        /market
│   ├── Screener           /market/screener
│   └── Instrument         /market/:symbol
├── Trading Tools          /tools
│   ├── Position size      /tools/position-size
│   ├── Risk/reward        /tools/risk-reward
│   ├── Profit/loss        /tools/profit-loss
│   └── Leverage           /tools/leverage
├── Alerts  🔒             /alerts
│   ├── New                /alerts/new
│   ├── Triggered          /alerts/triggered
│   └── Alert              /alerts/:alertId
├── Academy                /academy
│   ├── Topic              /academy/topics/:topicSlug
│   ├── Article            /academy/articles/:articleSlug
│   └── Glossary           /academy/glossary
├── Methodology            /methodology
│   ├── Scoring            /methodology/scoring
│   ├── Data modes         /methodology/data-modes
│   ├── Performance calc.  /methodology/performance-calculation
│   └── Strategies         /methodology/strategies
│       └── Strategy       /methodology/strategies/:strategyKey
├── Settings  🔒           /settings
│   ├── Account            /settings/account
│   ├── Preferences        /settings/preferences
│   ├── Notifications      /settings/notifications
│   └── Security           /settings/security
├── Risk Disclaimer        /risk-disclaimer
└── System                 /login  /signup  /logout  /terms  /privacy  (404 fallback)
```
🔒 = login required. 46 routes total (13 areas + system). Per-route detail: `routes.md`.

## 4. Area definitions
| # | Area | Purpose | Primary user | Key content | Access |
|---|---|---|---|---|---|
| 1 | **Signals** | See what is actionable right now | everyone | live feed, filters, confidence, side, levels summary | public |
| 2 | **Signal Detail** | Decide on one signal | everyone | levels, R:R, confidence breakdown, rationale, lifecycle events, outcome, actions | public |
| 3 | **Signal History** | Audit the past | evaluators | all closed/expired signals, outcome, filters, export later | public |
| 4 | **Performance** | Prove it works (or doesn't) | evaluators | win rate, avg R, drawdown, equity curve, by strategy | public |
| 5 | **Backtesting** | Test a strategy on history | active users | saved runs, run config, metrics, trades | auth |
| 6 | **Watchlist** | Follow chosen instruments | active users | lists, live prices, open-signal indicators | auth |
| 7 | **Market Analysis** | Context around signals | everyone | overview, screener, per-instrument analysis | public |
| 8 | **Trading Tools** | Size and check a trade | everyone | 4 calculators | public |
| 9 | **Alerts** | Be told when it matters | active users | rules, triggered log | auth |
| 10 | **Academy** | Learn concepts | newcomers | topics, articles, glossary | public |
| 11 | **Methodology** | Understand how it works | skeptics, regulators | scoring, data modes, performance definitions, strategy catalogue | public |
| 12 | **Settings** | Configure account and preferences | signed-in | account, preferences, notifications, security | auth |
| 13 | **Risk Disclaimer** | Full risk disclosure | everyone | legal-grade risk statement | public |

**Signal Detail note:** a major area with its own URL space but no nav item — it lives under Signals in the sidebar and breadcrumb, and is reached from Signals, History, Watchlist, Alerts, Market and Performance.

## 5. Access model
- **public** — anyone, including anonymous visitors.
- **authenticated** — anonymous visitors are redirected to `/login?returnTo=<original path+query>`; after login they land exactly where they were headed.
- Signed-in visitors opening `/login` or `/signup` are redirected to `/signals`.
- Entitlement tiers (free/paid) are a later concern; they will gate *content within* routes, not change the route structure.
- Guard logic: `guardRoute()` in `shared/routes.ts`, enforced by the client router and mirrored by the API (401/403).

## 6. Data mode in the IA
- The mode is **not** part of the path. Signals from different modes never share a URL namespace because IDs are globally unique per mode.
- The active mode is shown by a badge in the top bar on every page.
- Routes that display mode-dependent data accept an optional `?mode=DEMO|PAPER|LIVE`. It is honoured only if the server lists it in `ALLOWED_DATA_MODES`; otherwise the server default is used and the UI shows a notice. Shared links therefore reproduce the same mode.
- Users cannot switch into LIVE from the UI — LIVE is an environment decision (Part 01). Settings › Preferences may set a *default view mode* among allowed modes.
- `/methodology/data-modes` explains DEMO/PAPER/LIVE in plain language; the mode badge links to it.

## 7. URL conventions
- Lowercase, kebab-case, no trailing slash, no file extensions. IDs and slugs are opaque, URL-safe.
- Collections are plural nouns (`/alerts`); creation is `/…/new`; items are `/…/:id`.
- Reserved words (cannot be IDs/slugs): `new`, `screener`, `triggered`, `strategies`, `glossary`, `topics`, `articles`.
- Unknown paths render the 404 page (`not-found`) with search and links to Signals, Market, Academy. Paths with wrong case redirect to lowercase.
- Instrument symbols use the canonical `BASE-QUOTE` form: `/market/BTC-USDT` (upper-case symbols are the one exception to lowercase).

## 8. Query parameter conventions
| Param | Meaning | Values |
|---|---|---|
| `mode` | data mode | `DEMO` `PAPER` `LIVE` |
| `tf` | timeframe | `5m` `15m` `1h` `4h` `1d` |
| `status` | signal status | `open` `closed` `expired` |
| `side` | direction | `long` `short` |
| `outcome` | result | `tp` `sl` `expired` `cancelled` |
| `instrument`, `strategy` | filter by symbol / strategy key | string |
| `minConf` | min confidence | `0–100` |
| `since`, `until` | date range | `YYYY-MM-DD` |
| `period` | performance window | `7d` `30d` `90d` `1y` `all` |
| `sort` | sort key, `-` prefix = descending | e.g. `-createdAt` |
| `cursor` | pagination cursor | opaque |
| `q` | text search | string |
| `origin` | where the user came from (breadcrumbs) | `history` `watchlist` `alerts` |
| `returnTo` | post-login destination | URL-encoded internal path |
| `signalId` | prefill source | signal id |

Each route declares the exact params it accepts (`routes.md` › Query). `buildPath()` refuses undeclared keys.

## 9. Cross-area linking (contextual actions)
| From | To | How |
|---|---|---|
| Signal Detail | Market › Instrument | symbol link |
| Signal Detail | Methodology › Strategy | "How this signal works" |
| Signal Detail | Tools › Position size / Risk-reward | pre-filled via `signalId`, `entry`, `stop` |
| Signal Detail | Alerts › New | pre-filled via `signalId` |
| Signal Detail | Backtesting › New | pre-filled via `strategy`, `instrument`, `tf` |
| Signal Detail | Watchlist | add/remove instrument (inline action) |
| Signals | History | "See closed signals" |
| History | Performance | "See aggregate results" |
| Performance › Strategy | Methodology › Strategy | "Strategy definition" |
| Market › Instrument | Signals (filtered) / Alerts › New | instrument context |
| Alerts › Triggered | Signal Detail | `origin=alerts` |
| Tools | Academy › Glossary | term links |
| Any signal page | Risk Disclaimer | persistent footer + inline notice |

## 10. Page shells (layouts)
| Layout | Used for | Navigation |
|---|---|---|
| `app` | most pages | full sidebar / bottom tabs |
| `focus` | New backtest, New alert, Edit alert | sidebar collapsed, bottom tabs hidden, Cancel/Save bar |
| `reading` | Methodology, articles, glossary, legal, Risk Disclaimer | full nav, narrow content column, table of contents |
| `auth` | login, signup, logout | none, brand only |

## 11. SEO and indexing
- **Index**: Academy, Methodology, Trading Tools, Risk Disclaimer, Terms, Privacy — static, mode-independent.
- **Noindex**: everything showing signals, prices, performance, or user data. DEMO/PAPER output must never be indexed.
- Shared signal links carry `noindex` and use generic Open Graph text (no price levels) until LIVE policy is defined.

## 12. Empty, error and edge states (per area)
Every list route defines: loading, empty (with next action), filtered-empty ("clear filters"), error (retry), and stale-data (banner, e.g. engine paused / provider stale). Detail routes add: not-found (entity missing → 404 in area context, not global), and forbidden (entity belongs to another user → 404, never 403, to avoid leaking existence).

## 13. Out of scope for Part 02
Visual design, component design, copywriting, page implementation, real data, auth implementation.
