# CoinGabbarSignals — User Flows

Notation: **[route]** = page, → = navigation, ⚑ = decision, ✱ = risk/trust checkpoint. Route IDs in `routes.md`.

## F1. First visit (anonymous) → confidence → account
1. Land on **[/signals]** (via `/`). Mode badge and risk strip visible.
2. Scan feed; apply filters (status, side, tf) → URL updates.
3. Open a card → **[/signals/:id]**. ✱ First-visit risk notice (dismissible, remembered) linking **[/risk-disclaimer]**.
4. ⚑ "Can I trust this?" → **[/methodology/strategies/:key]** and **[/performance/strategies/:key]**.
5. Try an action that needs an account (Watchlist / Alert / Backtest) → **[/login?returnTo=…]** → **[/signup]** (✱ must acknowledge Risk Disclaimer).
6. After sign-up, return exactly to the page from step 3 with the action ready.

## F2. Evaluate and act on a signal (core loop)
1. **[/signals]** → **[/signals/:id]**.
2. Read levels, R:R, confidence breakdown, rationale.
3. ⚑ Size it → **[/tools/position-size?signalId=…&entry=…&stop=…]** (pre-filled) → back via Back/breadcrumb.
4. ⚑ Follow it → **Add to Watchlist** (inline) and/or **[/alerts/new?signalId=…]** (focus layout) → Save → returns to signal.
5. Later: bell → **[/alerts/triggered]** → **[/signals/:id?origin=alerts]** → outcome visible.

## F3. Audit track record ("Is it real?")
1. **[/history]** filter by strategy / date / outcome.
2. Open closed signal → **[/signals/:id?origin=history]** → see full lifecycle and outcome.
3. **[/performance]** → **[/performance/strategies]** → **[/performance/strategies/:key]**.
4. ⚑ Verify definitions → **[/methodology/performance-calculation]**.
5. ⚑ Test independently → **[/backtesting/new?strategy=…]**.

## F4. Run a backtest
1. **[/backtesting]** (auth) → "New" → **[/backtesting/new]** (focus).
2. Choose strategy, instrument, timeframe, date range (prefill supported from signal/strategy).
3. Submit → **[/backtesting/:runId]** shows progress, then metrics, equity curve, trades.
4. Actions: re-run with changes (→ new with params), open strategy methodology, back to list.
5. Errors: invalid range, no data, engine busy — inline, form state preserved.

## F5. Create and manage an alert
1. Entry points: Signal Detail, Market › Instrument, **[/alerts]**, or notification empty state.
2. **[/alerts/new]** (focus): pick type (new signal for instrument / price level / signal outcome), instrument, channel → Save.
3. **[/alerts]** lists rules → toggle, **[/alerts/:id]** to edit/delete.
4. Channel setup missing → **[/settings/notifications]** → return via `returnTo`.

## F6. Research an instrument
1. **[/market]** overview or **[/market/screener]** (filters).
2. **[/market/:symbol]** chart, levels, indicators, open signals.
3. Actions: view signals (→ `/signals?instrument=…`), add to watchlist, **[/alerts/new?instrument=…]**.

## F7. Learn a concept
1. **[/academy]** search (`q`) or browse topics → **[/academy/topics/:slug]** → **[/academy/articles/:slug]**.
2. Unknown term → **[/academy/glossary]**.
3. Article footers link to relevant **[/tools/…]** and to **[/methodology]** for product-specific detail.

## F8. Manage watchlist
1. **[/watchlist]** (auth) default list; live price + open-signal marker per instrument.
2. Add via search / from Market / from Signal Detail; remove inline.
3. Create/rename lists → **[/watchlist/:listId]**.
4. Tap an instrument with an open signal → Signal Detail (`origin=watchlist`).

## F9. Account setup and preferences
1. **[/settings]** (mobile list / desktop split).
2. Account (profile), Preferences (theme, timezone, default timeframe, default view mode among allowed modes), Notifications (channels, quiet hours), Security (password, sessions, 2FA).
3. Unsaved changes prompt on leave.

## F10. Auth gate and recovery
- Anonymous → protected route → **[/login?returnTo=…]** → success → `replace` to returnTo.
- Logged-in user opens `/login` → redirected to `/signals`.
- Session expiry mid-task: modal re-auth, preserving in-progress form state; on cancel → **[/login]** with returnTo.
- Log out **[/logout]** → **[/signals]**.

## F11. Errors and edge cases
| Situation | Behaviour |
|---|---|
| Unknown URL | 404 page with search + Signals / Market / Academy links |
| Signal ID not found | in-area not-found under Signals with "Back to signals" |
| Other user's alert/list/run | shown as not-found (no existence leak) |
| Requested `?mode` not allowed | notice, fallback to default mode |
| Engine paused / data stale | banner on signal-bearing pages; signals marked stale |
| API down | offline banner, cached content where safe, retry |
| Empty lists | explain + primary next action (e.g. "Create your first alert") |

## F12. Risk acknowledgement
| Moment | Requirement |
|---|---|
| Sign-up | checkbox + link to `/risk-disclaimer`, required |
| First Signal Detail view | dismissible notice, remembered per account/device |
| Every page | footer strip with link |
| Tools results | "informational only" line under results |
| LIVE mode first use | blocking confirmation once per account (recorded in `audit_log`) |
