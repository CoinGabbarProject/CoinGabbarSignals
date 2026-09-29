# CoinGabbarSignals — Navigation

Defined in code: `shared/navigation.ts` (items, groups, tab bar, states). Route facts: `shared/routes.ts`. No visual styling here; icons are semantic keys only.

## 1. Nav items (12) — every area except Signal Detail
| Item | Route | Auth | Badge | Icon key |
|---|---|---|---|---|
| Signals | `/signals` | – | `newSignals` | signal |
| History | `/history` | – | – | history |
| Performance | `/performance` | – | – | performance |
| Backtesting | `/backtesting` | 🔒 | – | backtest |
| Market | `/market` | – | – | market |
| Watchlist | `/watchlist` | 🔒 | – | watchlist |
| Tools | `/tools` | – | – | tools |
| Alerts | `/alerts` | 🔒 | `unreadAlerts` | alert |
| Academy | `/academy` | – | – | academy |
| Methodology | `/methodology` | – | – | methodology |
| Settings | `/settings` | 🔒 | – | settings |
| Risk disclaimer | `/risk-disclaimer` | – | – | shield |

Labels are short (one word where possible). "Signal Detail" has no item; it selects **Signals**.

## 2. Desktop navigation (≥ 1024px)
**Structure: persistent left sidebar + slim top bar + footer strip.**

Sidebar groups, top to bottom:
| Group | Items |
|---|---|
| Trade | Signals · History · Performance · Backtesting |
| Research | Market · Watchlist · Tools |
| Manage | Alerts |
| Learn | Academy · Methodology |
| *(pinned bottom)* Account | Settings |
| *(pinned bottom)* Legal | Risk disclaimer |

Rationale: *Trade* is the daily loop and sits first; *Research* supports decisions; *Manage* is set-and-forget; *Learn* is occasional.

**Top bar (left → right):**
1. Breadcrumbs (when depth > 1).
2. Global search / command palette — opens with `/` or `⌘K`/`Ctrl+K`; searches instruments, signals by ID, strategies, Academy articles, glossary, and jumps to any area.
3. **Data-mode badge** — always visible; links to `/methodology/data-modes`.
4. Notifications bell → `/alerts/triggered` (unread count = `unreadAlerts`).
5. Account menu — signed in: Settings, Log out. Anonymous: Log in / Sign up.

**Footer strip (every page):** risk one-liner + links Risk disclaimer · Terms · Privacy · Methodology.

**Sidebar behaviours:** collapsible to icon-only (preference remembered); auto-collapsed on `focus` layout; ≥1440px defaults expanded; group headings hidden when collapsed; tooltips on hover/focus when collapsed.

## 3. Mobile navigation (< 1024px)
**Structure: compact top bar + bottom tab bar (5 slots) + "More" sheet.**

| Slot | Destination |
|---|---|
| 1 | Signals |
| 2 | Market |
| 3 | Watchlist |
| 4 | Alerts (badge) |
| 5 | **More** → sheet |

**More sheet groups:** Trade (History, Performance, Backtesting) · Research (Tools) · Learn (Academy, Methodology) · Account (Settings) · Legal (Risk disclaimer). Together, tabs + sheet reach all 12 items exactly once (enforced by test).

Rules:
- The **More** tab shows as selected when the current area is inside the sheet (e.g. Performance).
- Top bar: back button (on any page deeper than an area root) or area title; search icon; mode badge (compact); account/bell collapsed into More/Alerts.
- Bottom tabs are **hidden** on `focus` layouts and while a form has unsaved changes; a Cancel/Save bar replaces them.
- Tapping the selected tab scrolls to top; a second tap returns to the area root.
- Each tab keeps its own back stack (switching tabs doesn't lose place).
- Breadcrumbs are replaced by **Back + current title**; Back uses history when the user arrived in-app, else goes to the breadcrumb parent.
- Safe-area insets respected; tab targets ≥ 44×44 px.

## 4. Breadcrumbs
- Source: `parent` chain in the registry; `getBreadcrumbs()` builds `{label, path, current}`.
- Shown only when depth > 1 (top-level area pages show none). No "Home" crumb — Signals is home.
- The last crumb is the current page (not a link). Dynamic crumbs (`{param}`) show the entity's title once loaded, and the raw param as a skeleton label until then.
- **Origin-aware:** Signal Detail's parent depends on `?origin=`:

| Opened from | Trail |
|---|---|
| Signals (default) | Signals › Signal `id` |
| `origin=history` | History › Signal `id` |
| `origin=watchlist` | Watchlist › Signal `id` |
| `origin=alerts` | Alerts › Triggered › Signal `id` |

- Long trails truncate the middle with an ellipsis menu; a11y: `<nav aria-label="Breadcrumb">`, `aria-current="page"`.
- Sidebar selection is unaffected by origin (Signal Detail always selects Signals).

## 5. Navigation states
| State | Applies to | Definition | Behaviour |
|---|---|---|---|
| **default** | item | not current, available | navigates |
| **selected** | item | current route's `activeNav` equals item (includes descendants, and Signal Detail → Signals) | `aria-current="page"`; not re-navigated on click (scrolls top) |
| **locked** | item | `requiresAuth` and visitor anonymous | shows lock cue; click → `/login?returnTo=<target>` |
| **badged** | Signals, Alerts | count > 0 | numeric badge (99+ cap); cleared per rules below |
| **collapsed** | sidebar | icon-only | tooltip on hover/focus |
| **focus-mode** | shell | `focus` layout | sidebar collapsed, tabs hidden, Cancel/Save bar |
| **hover / keyboard-focus / pressed** | item | interaction states | visible focus ring required (visual spec later) |
| **loading** | route | data fetching | nav stays interactive; page shows skeleton |
| **offline / degraded** | shell | API unreachable or engine paused/stale | banner under top bar; nav unaffected |
| **mode-restricted** | mode-dependent pages | requested `?mode` not allowed | notice + fallback to server default |

Badge rules: `newSignals` = signals created since the user last viewed `/signals` (resets on visit); `unreadAlerts` = triggered alerts not yet seen (resets when `/alerts/triggered` is opened).
Resolved in code by `resolveNavItemState()` → `{selected, locked, badgeCount}` and `isMoreTabSelected()`.

## 6. Keyboard & accessibility
- Sidebar is a `<nav aria-label="Primary">` with grouped lists; tab bar is `<nav aria-label="Primary">` on mobile (only one is rendered at a time).
- Skip link "Skip to content" first in tab order.
- `/` or `⌘K` opens search; `g` then `s/h/p/m/w/a` jumps to Signals/History/Performance/Market/Watchlist/Alerts (desktop, discoverable in a shortcuts dialog); shortcuts disabled inside inputs.
- Route changes move focus to the page `<h1>` and announce the title.

## 7. Routing behaviours
- Anonymous → auth route: redirect to login with `returnTo`; after login, `replace` navigate to it.
- `/settings` on desktop renders Account inside a split view (list left, panel right); on mobile it is a list page.
- Scroll restoration: back/forward restore scroll and filter state (state lives in URL).
- Filter changes use `replace`, not `push`, to avoid back-button spam; opening an item uses `push`.
- Unsaved-changes guard on `focus` layouts.
- Logout clears client caches and lands on `/signals`.
