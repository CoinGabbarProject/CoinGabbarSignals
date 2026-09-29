# CoinGabbarSignals — Wireframes (Part 03)

> Three new wireframes — **Desktop, Tablet, Mobile** — for a professional crypto research terminal.
> Built only from the Part 02 IA (`shared/routes.ts`, `shared/navigation.ts`), `design-system.md` tokens and `signal-engine.md` scoring inputs. No layout, label or structure from any existing CoinGabbar site is used.
> Scope: **wireframes only** — structure, dimensions, order, behaviour. No visual polish, no implementation, no copywriting.

## 0. How to read this document

- **Reference page:** Signal Detail (`/signals/:signalId`). It is the terminal's densest page and the only one that carries the full signal hierarchy. Every other `app`-layout page reuses the **shell** (§2) and swaps the content zones.
- **Diagrams are schematic, not to scale.** Exact numbers live in the tables. All sizes are CSS px.
- **Tokens** come from `design-system.md` (colors, 4-px spacing scale `4 8 12 16 24 32 48`, radii `6/10/999`). Paddings and gaps below use only those spacing tokens. Layout metrics (bar heights, rail widths) are new constants listed in §9.
- Legend: `L` = login-required item (locked cue), `[4]` = badge, `*` = selected tab, `(!)` = risk notice, `✓ / ✗` = pass/fail (always icon + text, never color alone).

---

## 1. Signal hierarchy (canonical order)

The hierarchy is the **reading order, DOM order and tab order on every breakpoint**. Layout may place things side by side, but never reorders them.

```
Market → Signal → Entry → Risk → Targets → Chart → Evidence → Signal Score → History
  1        2        3       4       5         6        7            8            9
```

| # | Component | Question it answers | Source data |
|---|---|---|---|
| 1 | **Market** | What instrument, what price, what regime? | instrument, last price, 24h change, regime, timeframe, freshness |
| 2 | **Signal** | What is being called? | side, strategy + version, timeframe, status, ID, age, score shortcut, actions |
| 3 | **Entry** | Where do I get in? | entry price/zone, distance to last price, validity window |
| 4 | **Risk** | Where am I wrong, and what does it cost? | stop, distance %, ATR multiple, R:R, invalidation rule |
| 5 | **Targets** | Where do I get paid? | TP1–TP3 price, R-multiple, hit status |
| 6 | **Chart** | Show me. | closed candles + entry/stop/target overlays |
| 7 | **Evidence** | Why does the engine believe it? | rationale inputs, indicator values, levels, lifecycle events |
| 8 | **Signal Score** | How strongly? | 0–100 confidence + five weighted sub-scores |
| 9 | **History** | Has this worked before? | past signals (same instrument + strategy), performance summary |

**Supporting panels (extend, never replace, a hierarchy step):**

| Id | Panel | Extends | Desktop | Tablet | Mobile |
|---|---|---|---|---|---|
| R1 | Risk intelligence | 4 Risk | right rail, 1st | 2-up row after Chart | accordion, open |
| R2 | Market intelligence | 1 Market | right rail, 2nd | 2-up row after Chart | accordion, closed |
| R3 | Data health | mode / freshness | right rail, 3rd | slim strip | chip row |

**Score shortcut:** the Signal header (2) shows a small read-only `Score 82 >` chip that scrolls to component 8. It is a shortcut, not the canonical position; full breakdown appears only at step 8.

---

## 2. Shell (shared by all three sizes)

Regions in DOM order: **Mode banner slot → Header → Navigation → Main → Complementary rail → Footer**.

| Region | Landmark | Contents (from `navigation.ts`) |
|---|---|---|
| Mode banner slot | `role="status"` | DEMO: "simulated data" ribbon · LIVE: persistent live bar · PAPER: none (slot height 0) |
| Header | `banner` | breadcrumbs · global search (`/`, `⌘K`) · data-mode badge (links `/methodology/data-modes`) · notifications bell → `/alerts/triggered` · account menu |
| Navigation | `nav aria-label="Primary"` | Desktop: left sidebar (groups Trade / Research / Manage / Learn, pinned Account + Legal). <1024: bottom tab bar (Signals · Market · Watchlist · Alerts · More) |
| Main | `main` | Signal Detail zones (§3–§5) |
| Rail | `aside aria-label="Risk and market intelligence"` | R1, R2, R3 (desktop only as a column) |
| Footer | `contentinfo` | risk one-liner + Risk disclaimer · Terms · Privacy · Methodology |

System banners (engine paused, provider stale, offline) render in a **status slot directly under the header**: h40, full content width, pushes content down, never overlaps.

---

## 3. DESKTOP wireframe (≥ 1024 px) — reference 1440 × 900

### 3.1 Layout diagram

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ A  MODE BANNER slot h32 | DEMO: 'Simulated data' ribbon | LIVE: persistent live bar | PAPER: none            │
├──────────────────┬───────────────────────────────────────────────────────────────────────────────────────────┤
│  H  CoinGabbar   │ Signals > Signal CGS-0142   [ Search  /  Cmd+K ]  [DEMO] (Bell 2) (Acct)                  │
├──────────────────┼──────────────────────────────────────────────────────────┬────────────────────────────────┤
│ TRADE            │ ┌─ 1 MARKET  h64 ──────────────────────────────────────┐ │ ┌─ R1 RISK INTELLIGENCE ─────┐ │
│ ▌▸ Signals  [4]  │ │ BTC-USDT  67,420.50  +2.1%   Vol 1.8B                │ │ │ R:R  1.0 / 2.0 / 3.1       │ │
│    History       │ │ Uptrend | TF [5m 15m 1h 4h 1d] | upd 2s ago          │ │ │ Risk at 1.0% : $100        │ │
│    Performance   │ └──────────────────────────────────────────────────────┘ │ │ Size preview: 0.137 BTC    │ │
│   Backtesting L  │ ┌─ 2 SIGNAL  h88 ──────────────────────────────────────┐ │ │ Max loss if SL: -1.08%     │ │
│                  │ │ [▲ LONG] BTC-USDT 1h {strategy} v3 [OPEN]            │ │ │ Invalid: 1h close < SL     │ │
│ RESEARCH         │ │ CGS-0142 | 14:05 | 3h  [Score 82 >]  (W)(A)(S)(B)    │ │ │ (!) Informational only,    │ │
│    Market        │ └──────────────────────────────────────────────────────┘ │ │     not financial advice   │ │
│    Watchlist  L  │ ┌─ 3 ENTRY ──────┐ ┌─ 4 RISK ───────┐ ┌─ 5 TARGETS ────┐ │ │ [Size it] [Risk/reward]    │ │
│    Tools         │ │                │ │                │ │                │ │ └────────────────────────────┘ │
│                  │ │ 67,420.50      │ │ STOP 66,690    │ │ TP1 68,150 1.0R│ │ ┌─ R2 MARKET INTELLIGENCE ───┐ │
│ MANAGE           │ │ zone 67,380-460│ │ dist -1.08%    │ │ TP2 68,900 2.0R│ │ │ Regime      Uptrend        │ │
│    Alerts  [2]   │ │ vs last  +0.0% │ │ R:R  1 : 2.6   │ │ TP3 69,650 3.1R│ │ │ Volatility  ATR 1.1%  Med  │ │
│                  │ │ valid 4 candles│ │ inval: close<SL│ │ all pending    │ │ │ HTF bias    4h Long        │ │
│ LEARN            │ │                │ │                │ │                │ │ │ Funding     +0.01%         │ │
│    Academy       │ └────────────────┘ └────────────────┘ └────────────────┘ │ │ Breadth     62% > EMA50    │ │
│    Methodology   │ ┌─ 6 CHART  40 toolbar + canvas ───────────────────────┐ │ │ BTC corr    --             │ │
│                  │ │ [Candles][Levels][Volume][Indicators]     [Fit][Full]│ │ └────────────────────────────┘ │
│                  │ │                                                      │ │ ┌─ R3 DATA HEALTH ───────────┐ │
│                  │ │ TP3 ------------------------------------- 69,650     │ │ │ Provider  OK  | lag 1.2s   │ │
│                  │ │ TP2 ------------------------------------- 68,900     │ │ │ Engine    Running          │ │
│                  │ │ TP1 ------------------------------------- 68,150     │ │ │ Mode      DEMO             │ │
│                  │ │ ENT ============= (▲ signal candle) ======= 67,420   │ │ │ [ Data modes > ]           │ │
│                  │ │ SL  ------------------------------------- 66,690     │ │ └────────────────────────────┘ │
│                  │ │                                                      │ │                                │
│                  │ │         closed candles only - no repaint             │ │                                │
│                  │ └──────────────────────────────────────────────────────┘ │                                │
│                  ├──────────────────────────────────────────────────────────┼────────────────────────────────┤
│                  │ ┌─ 7 EVIDENCE ─────────────────────────────────────────┐ │ ┌─ 8 SIGNAL SCORE ───────────┐ │
│                  │ │ [Rationale][Indicators][Levels][Lifecycle]           │ │ │         ( 82 / 100 )       │ │
│                  │ │                                                      │ │ │          Strong            │ │
│                  │ │ ✓ Trend    EMA20 > EMA50 > EMA200  (1h, 4h)          │ │ │                            │ │
│                  │ │ ✓ Momentum RSI 58, rising, no divergence             │ │ │ Trend    ████████░░ 86 w30 │ │
│                  │ │ ✓ Volume   z-score +1.4 on trigger candle            │ │ │ Momentum ███████░░░ 74 w20 │ │
│                  │ │ ✗ Volatil. ATR% above 30d median (+18%)              │ │ │ Volume   ████████░░ 81 w20 │ │
│                  │ │ ✓ MTF      15m / 1h / 4h agree: Long                 │ │ │ Vol.reg  ██████░░░░ 62 w15 │ │
│                  │ │                                                      │ │ │ MTF      █████████░ 90 w15 │ │
│                  │ │ Events: created 14:05 | armed 14:05                  │ │ │ [ Scoring method > ]       │ │
│                  │ │ [ How this signal works > ]                          │ │ └────────────────────────────┘ │
│                  │ └──────────────────────────────────────────────────────┘ │                                │
│                  ├──────────────────────────────────────────────────────────┼────────────────────────────────┤
│                  │ ┌─ 9 HISTORY  same instrument + strategy ──────────────┐ │ ┌─ PERFORMANCE ──────────────┐ │
│                  │ │ ID        Opened  Side  Entry    Exit     Out  R     │ │ │ Period [30d 90d 1y]        │ │
│                  │ │ CGS-0139  09-27   ▲ L   66,910   67,840   TP   +1.0  │ │ │ Win rate 58%  Avg R +0.42  │ │
│                  │ │ CGS-0131  09-25   ▼ S   68,200   68,890   SL   -1.0  │ │ │ Max DD -6.1R  Sample n=64  │ │
│ ACCOUNT          │ │ CGS-0127  09-24   ▲ L   65,400   66,720   TP   +2.0  │ │ │   /\__/\  /\/\_/\/   equity│ │
│   Settings   L   │ │ CGS-0120  09-22   ▲ L   64,880   64,310   SL   -1.0  │ │ │ (!) DEMO data: simulated   │ │
│ LEGAL            │ │ (... 10 rows, row h40, sortable)                     │ │ │ [Strategy perf >]          │ │
│   Risk disclaimer│ │ [ View all in History > ]                            │ │ │ [Definitions >]            │ │
│ [«] collapse     │ └──────────────────────────────────────────────────────┘ │ └────────────────────────────┘ │
├──────────────────┴──────────────────────────────────────────────────────────┴────────────────────────────────┤
│ F FOOTER h48  Informational, not financial advice.  Risk disclaimer · Terms · Privacy · Methodology          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Horizontal measurements at 1440

```
  Sidebar        Page pad        Main (1fr)          Gap        Rail        Pad
|<--- 240 --->|<-- 24 -->|<------- 768 ------->|<-- 24 -->|<-- 360 -->|<-- 24 -->|  = 1440
                          |<---------------- inner 1152 ---------------->|
```

| Element | Width | Notes |
|---|---|---|
| Viewport | 1440 | reference |
| Sidebar | **240** expanded / **64** collapsed | `position: sticky`, `top: banner + 56`, full remaining height, own scroll |
| Content column | 1200 | viewport − sidebar |
| Page padding (L/R) | **24** | token 24 |
| Inner width | **1152** | 1200 − 2×24; capped at `max-width: 1600` and centered above ~1930 |
| Main track | **768** | `minmax(0, 1fr)` |
| Track gap | **24** | token 24 |
| Rail track | **360** | fixed |

### 3.3 Grid

Two tracks, used identically by all three vertical zones so columns line up top to bottom:

```css
.zone { display: grid; grid-template-columns: minmax(0, 1fr) var(--rail-w); column-gap: 24px; }
.zone + .zone { margin-top: 24px; }
```

| Viewport | Sidebar (default) | `--rail-w` | Inner width (example) | Main (example) |
|---|---|---|---|---|
| 1440+ | expanded 240 | 360 | 1152 @1440 | 768 |
| 1280–1439 | collapsed 64 | 360 | 1168 @1280 | 784 |
| 1024–1279 | collapsed 64 | 320 | 912 @1024 | 568 |

Sidebar expand/collapse is a user preference and is remembered. **Container rule:** if the content inner width falls below **880** (e.g. 1024–1279 with the sidebar expanded), the rail drops below the Chart and adopts the tablet 2-up arrangement (§4) instead of squeezing Main.

Inside Main, Entry / Risk / Targets use a 3-column subgrid: `grid-template-columns: repeat(3, 1fr); column-gap: 16px` → 245.33 each at 1440, 178.67 at 1024.

### 3.4 Vertical order, zones and exact spacing

| Zone | Main track | Rail track | Spacing |
|---|---|---|---|
| **Z1 Signal zone** | 1 Market → 2 Signal → 3/4/5 Entry·Risk·Targets → 6 Chart | R1 Risk intel → R2 Market intel → R3 Data health | components: **16** apart; zone padding-top **24** |
| **Z2 Analysis zone** | 7 Evidence | 8 Signal Score | starts **24** below Z1 |
| **Z3 History zone** | 9 History table | Performance summary | starts **24** below Z2 |
| **Footer** | spans content column | | **32** above; h **48** |

Fixed heights (px) inside Z1: Market **64** · Signal **88** · Entry/Risk/Targets **168** · Chart toolbar **40** + canvas `clamp(320, 42vh, 480)`.

**Above-the-fold guarantee (1440 × 900, no banner):** 56 header + 24 + 64 + 16 + 88 + 16 + 168 + 16 = 448 → chart occupies 448–866. Market through Chart are fully visible. With the 32-px banner the chart ends at 898, still inside the fold.

### 3.5 Component specifications (desktop)

Common card: `bg.surface`, 1px `border.subtle`, radius **10**, padding **16**, card header row h **40** (12px uppercase muted title left, status/action right). Numbers: JetBrains Mono, tabular, right-aligned.

| # | Component | Layout | Contents & behaviour |
|---|---|---|---|
| A | Mode banner | h32 (0 in PAPER), sticky | DEMO ribbon text "Simulated data"; LIVE bar in `mode.live`. Header `top` = banner height |
| H | Header | h**56**, sticky; grid `240px 1fr auto` | col 1 brand block (width = sidebar width, follows collapse to 64); col 2 breadcrumbs (`Signals › Signal CGS-0142`, origin-aware) + search (max-width 480, centered); col 3 mode badge · bell · account, gap 12 |
| N | Sidebar | w240/64; padding 12; group label h32; item h**40**, radius 6, gap 4 | order per `DESKTOP_NAV`; selected = Signals; locked cue on Backtesting/Watchlist/Settings when anonymous; badges `newSignals`, `unreadAlerts`; Account + Legal pinned to bottom; tooltips when collapsed |
| 0 | First-visit notice (optional) | h48, above Market, margin-bottom 16 | dismissible risk notice linking `/risk-disclaimer`; remembered |
| 1 | **Market** | flex, h64, padding 12/16 | left: symbol (link `/market/:symbol`), last price 24px mono, 24h change chip (▲/▼ + %); middle: 24h volume, regime chip; right: timeframe segmented control (5 segments, h32, min 44 wide) + freshness dot "updated 2s ago" |
| 2 | **Signal** | h88, two rows of 32, row gap 8 | row 1: side pill h28 (`▲ LONG` / `▼ SHORT`), instrument, TF chip, `{strategyKey} v{n}` (link to methodology), status chip (open / closed / expired). Row 2: ID (mono), opened time, age, `Score 82 >` chip; right: 4 icon buttons 32×32, gap 8 — Watchlist, New alert, Position size, Backtest (tooltips; locked ones route to login with `returnTo`) |
| 3 | **Entry** | card h168 | entry price 24px mono; zone low–high; distance to last price %; validity (candles/expiry); state chip (waiting / triggered / missed) |
| 4 | **Risk** | card h168 | stop price 24px mono in `signal.short`; distance %; ATR multiple; R:R (to TP1 and blended); invalidation rule in one line |
| 5 | **Targets** | card h168 | TP1–TP3 rows h32: price · R-multiple · % · hit status (pending / ✓ hit). Extra targets scroll inside card |
| 6 | **Chart** | card; toolbar h40 + canvas `clamp(320px, 42vh, 480px)` | toolbar: series toggles (Candles, Levels, Volume, Indicators), Fit, Fullscreen. Overlays: entry (neutral), stop (`signal.short`), targets (`signal.long`), last price, signal-candle marker. Level labels pinned to price axis with prices. **Closed candles only; markers never repaint.** Crosshair readout top-left |
| R1 | Risk intelligence | rail card, padding 16 | R:R at TP1/TP2/TP3; risk at user's risk % (default 1.0%) and position-size preview; max loss to stop; invalidation; inline "informational, not financial advice" notice; actions `Size it` → `/tools/position-size?signalId=…&entry=…&stop=…`, `Risk/reward` |
| R2 | Market intelligence | rail card | regime, volatility (ATR%), higher-timeframe bias, funding, breadth; unavailable values show "—" with reason on hover/focus |
| R3 | Data health | rail card, compact | provider status + lag, engine state, mode badge, link `Data modes` |
| 7 | **Evidence** | card, min-h360; tabs h40 | tabs: **Rationale** (default) · **Indicators** · **Levels** · **Lifecycle**. Rationale rows h40: label · value · `✓/✗` + text, covering the five score inputs (trend, momentum, volume, volatility, multi-timeframe). Link "How this signal works" → `/methodology/strategies/:key` |
| 8 | **Signal Score** | card, same height as Evidence (grid stretch) | ring 120×120 with 0–100 at 32px + label (Weak / Moderate / Strong — thresholds defined in Methodology); five sub-score rows h40: name · bar · value · weight. Link "Scoring method" → `/methodology/scoring` |
| 9 | **History** | table card, full Main track | columns: ID · Opened · Side · Entry · Exit · Outcome · R · Duration. Header h40, rows h40, 10 rows, sortable, row → `/signals/:id?origin=history`. Footer link → `/history?instrument=…&strategy=…` |
| P | Performance summary | rail card | period select (30d / 90d / 1y), win rate, avg R, max drawdown, sample size, equity sparkline (h80), DEMO/PAPER disclaimer, links to `/performance/strategies/:key` and `/methodology/performance-calculation` |
| F | Footer | h48, padding 12/24 | risk one-liner left; links right (Risk disclaimer · Terms · Privacy · Methodology). Wraps to auto height below 1280 |

### 3.6 Desktop behaviours

- **Sticky:** banner + header always; sidebar always; **rail sticks within Z1 only** (`top: banner + 56 + 16`, `max-height: 100vh − top − 16`, own scroll) and scrolls away with Z1.
- **Keyboard:** DOM/tab order = hierarchy (1→9), rail (R1–R3) after Chart, then Z2, Z3. Skip link "Skip to content" first. `g s/h/p/m/w/a` jump shortcuts from `navigation.md`.
- **Chart interaction:** wheel zooms, drag pans, double-click fits; chart never traps page scroll unless focused.
- **Density:** no motion except value-change flashes ≤120ms; honor `prefers-reduced-motion`.

---

## 4. TABLET wireframe (640 – 1023 px) — reference 768 × 1024

Tablet has **no sidebar**. It uses the mobile navigation model from `navigation.md` (top bar + bottom tab bar) with a wider content grid.

### 4.1 Layout diagram

```
┌─ TABLET 768 x 1024 (640-1023) ───────────────────────────────┐
│              DEMO: simulated data ribbon (h32)               │
│┌─ T TOP BAR h56 ────────────────────────────────────────────┐│
││ [<] Signal CGS-0142             (Q) [DEMO] (Bell)          ││
│└────────────────────────────────────────────────────────────┘│
│┌─ 1 MARKET h64 ─────────────────────────────────────────────┐│
││ BTC-USDT 67,420.50 +2.1%  Uptrend   [5m 15m 1h 4h 1d]      ││
│└────────────────────────────────────────────────────────────┘│
│┌─ 2 SIGNAL h88 ─────────────────────────────────────────────┐│
││ [▲ LONG] BTC-USDT 1h {strategy} v3  [OPEN]                 ││
││ CGS-0142 | 14:05 | 3h  [Score 82 >]   (W)(A)(S)(B)         ││
│└────────────────────────────────────────────────────────────┘│
│┌─ 3 ENTRY ────────┐ ┌─ 4 RISK ─────────┐ ┌─ 5 TARGETS ──────┐│
││ 67,420.50        │ │ STOP 66,690      │ │ TP1 68,150 1.0R  ││
││ zone 380-460     │ │ dist -1.08%      │ │ TP2 68,900 2.0R  ││
││ vs last +0.0%    │ │ R:R 1 : 2.6      │ │ TP3 69,650 3.1R  ││
││ valid 4 candles  │ │ invalid: close<SL│ │ all pending      ││
│└──────────────────┘ └──────────────────┘ └──────────────────┘│
│┌─ 6 CHART  toolbar 40 + canvas clamp(320,36vh,440) ─────────┐│
││ [Candles][Levels][Volume][Indicators]     [Fit][Full]      ││
││                                                            ││
││ TP3 ---------------------------------- 69,650              ││
││ TP2 ---------------------------------- 68,900              ││
││ TP1 ---------------------------------- 68,150              ││
││ ENT ========== (▲) ===================== 67,420            ││
││ SL  ---------------------------------- 66,690              ││
││                                                            ││
│└────────────────────────────────────────────────────────────┘│
│┌─ R1 RISK INTEL ─────────────┐ ┌─ R2 MARKET INTEL ──────────┐│
││ R:R 1.0/2.0/3.1             │ │ Regime  Uptrend            ││
││ Risk 1.0% : $100            │ │ ATR 1.1% Med               ││
││ Size 0.137 BTC              │ │ HTF 4h Long                ││
││ (!) not advice              │ │ Funding +0.01%             ││
││ [Size it][R/R]              │ │ Breadth 62%                ││
│└─────────────────────────────┘ └────────────────────────────┘│
│┌─ R3 DATA HEALTH strip h40 ─────────────────────────────────┐│
││ Provider OK 1.2s | Engine Running | DEMO                   ││
│└────────────────────────────────────────────────────────────┘│
│┌─ 7 EVIDENCE ───────────────────────────────────────────────┐│
││ [Rationale][Indicators][Levels][Lifecycle]                 ││
││ ✓ Trend    EMA20>EMA50>EMA200 (1h,4h)                      ││
││ ✓ Momentum RSI 58 rising                                   ││
││ ✓ Volume   z +1.4                                          ││
││ ✗ Volatil. ATR% +18% vs median                             ││
││ ✓ MTF      15m/1h/4h agree                                 ││
│└────────────────────────────────────────────────────────────┘│
│┌─ 8 SIGNAL SCORE ───────────────────────────────────────────┐│
││   ( 82 )     Trend align  ████████░░ 86  w30               ││
││   Strong     Momentum     ███████░░░ 74  w20               ││
││   ring 120   Volume conf. ████████░░ 81  w20               ││
││              Vol. regime  ██████░░░░ 62  w15               ││
││              MTF agree    █████████░ 90  w15               ││
│└────────────────────────────────────────────────────────────┘│
│┌─ 9 HISTORY ────────────────────────────────────────────────┐│
││ [Win 58%][Avg R +0.42][MaxDD -6.1R][n=64]   KPI strip h72  ││
││   /\__/\  /\/\_/\/   equity sparkline h96                  ││
││ Opened  Side  Outcome   R      Dur     (rows h44)          ││
││ 09-27   ▲ L   TP      +1.0    6h   >                       ││
││ 09-25   ▼ S   SL      -1.0    3h   >                       ││
││ [ View all in History > ]                                  ││
│└────────────────────────────────────────────────────────────┘│
│┌─ F FOOTER (auto, wraps to 2 lines) ────────────────────────┐│
││ Informational, not financial advice.                       ││
││ Risk disclaimer · Terms · Privacy · Methodology            ││
│└────────────────────────────────────────────────────────────┘│
│┌─ B TAB BAR h64 + safe-area ────────────────────────────────┐│
││ [Signals*] [Market] [Watchlist] [Alerts 2] [More]          ││
│└────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Grid and spacing

| Property | Value |
|---|---|
| Columns | **6** |
| Page margin | **24** |
| Gutter | **16** |
| Inner width @768 | 720 → column = (720 − 5×16) / 6 = **106.67** |
| Zone gap | **24** · component gap **16** · card padding **16** |
| Top bar | h**56** (sticky) · banner h**32** |
| Tab bar | h**64** + safe-area inset (fixed bottom) · content `padding-bottom = 64 + inset + 16` |

### 4.3 Placement (columns of 6)

| # | Component | Span | Height |
|---|---|---|---|
| 1 Market | 6 | 64 |
| 2 Signal | 6 | 88 |
| 3 Entry | 2 (229.33 @768) | 168 |
| 4 Risk | 2 | 168 |
| 5 Targets | 2 | 168 |
| 6 Chart | 6 | toolbar 40 + canvas `clamp(320px, 36vh, 440px)` |
| R1 Risk intel | 3 (352 @768) | auto |
| R2 Market intel | 3 | auto (equal to R1) |
| R3 Data health | 6 | 40 strip |
| 7 Evidence | 6 | auto, tabs h44 |
| 8 Signal Score | 6 | ring 120 in cols 1–2, sub-scores in cols 3–6 |
| 9 History | 6 | KPI strip h72 (4 equal cells) → sparkline h96 → table (rows h**44**) |
| F Footer | 6 | auto; 16 padding |

**Above the fold (768 × 1024):** 32 + 56 + 24 + 64 + 16 + 88 + 16 + 168 + 16 = 456 → chart 456–~864; tab bar starts at 960. Market → Chart visible.

### 4.4 Tablet behaviours

- Header: back button + title `Signal {id}` (replaces breadcrumbs), search icon (opens full-width overlay), compact mode badge, bell. Account lives in **More**.
- Below 720px inner width, Entry/Risk/Targets keep 3-up down to 640 (min card width ≈ 186 @640); below 640 the mobile layout takes over.
- History table drops columns **ID, Entry, Exit**; the row chevron opens detail. Full columns available on tap-expand.
- Landscape ≥1024 switches to the desktop layout (sidebar collapsed).
- Bottom tabs hidden on `focus` layouts (New alert / New backtest) — replaced by Cancel/Save bar.

---

## 5. MOBILE wireframe (360 – 639 px) — reference 390 × 844

### 5.1 Layout diagram

```
┌─ MOBILE 390 x 844 (360-639) ─────┐
│         DEMO ribbon h24          │
│┌─ T TOP BAR h48 ────────────────┐│
││ [<] Signal CGS-0142  (Q)[DEMO] ││
│└────────────────────────────────┘│
│┌─ S STICKY MINI h48 ────────────┐│
││ ▲ LONG BTC-USDT 67,420 [82]    ││
│└────────────────────────────────┘│
│┌─ 1 MARKET h136 ────────────────┐│
││ BTC-USDT      67,420.50        ││
││ +2.1%  Uptrend  upd 2s         ││
││ [5m][15m][1h][4h][1d] >>       ││
│└────────────────────────────────┘│
│┌─ 2 SIGNAL h136 ────────────────┐│
││ [▲ LONG] BTC-USDT [OPEN]       ││
││ {strategy} v3 | 1h | 3h ago    ││
││ [Score 82 >]                   ││
││ [W]  [A]  [S]  [B]  h44        ││
│└────────────────────────────────┘│
│┌─ 3 ENTRY ────┐ ┌─ 4 RISK ──────┐│
││ 67,420.50    │ │ STOP 66,690   ││
││ zone 380-460 │ │ dist -1.08%   ││
││ vs last 0.0% │ │ R:R 1 : 2.6   ││
││ valid 4c     │ │ close<SL=out  ││
│└──────────────┘ └───────────────┘│
│┌─ 5 TARGETS h40 + 3 x h40 ──────┐│
││ TP1  68,150   1.0R  [ ]        ││
││ TP2  68,900   2.0R  [ ]        ││
││ TP3  69,650   3.1R  [ ]        ││
│└────────────────────────────────┘│
│┌─ 6 CHART tb40 + 280 ───────────┐│
││ [Candles][Lvls][Vol]  [Full]   ││
││                                ││
││ TP3 ------------- 69,650       ││
││ TP2 ------------- 68,900       ││
││ TP1 ------------- 68,150       ││
││ ENT ====(▲)======= 67,420      ││
││ SL  ------------- 66,690       ││
││                                ││
││ (Entry)(SL)(TP1)(TP2)(TP3)     ││
│└────────────────────────────────┘│
│┌─ R1 RISK INTEL  h48 (open) ────┐│
││ R:R 1.0/2.0/3.1                ││
││ Risk 1.0%: $100                ││
││ Size 0.137 BTC                 ││
││ (!) not financial advice       ││
││ [Size it]  [Risk/reward]       ││
│└────────────────────────────────┘│
│┌─ R2 MARKET INTEL h48 (shut) ───┐│
││ v Regime, ATR, HTF, funding    ││
│└────────────────────────────────┘│
│┌─ R3 HEALTH chip h40 ───────────┐│
││ Provider OK | Engine Run | DEMO││
│└────────────────────────────────┘│
│┌─ 7 EVIDENCE ───────────────────┐│
││ [Rationale][Indic.][Levels] >> ││
││ ✓ Trend   EMA stack aligned    ││
││ ✓ Momentum RSI 58 rising       ││
││ ✓ Volume  z +1.4               ││
││ ✗ Volatil. ATR% +18%           ││
││ ✓ MTF     15m/1h/4h agree      ││
│└────────────────────────────────┘│
│┌─ 8 SIGNAL SCORE ───────────────┐│
││         ( 82 )                 ││
││         Strong                 ││
││ Trend   ████████░░ 86          ││
││ Moment. ███████░░░ 74          ││
││ Volume  ████████░░ 81          ││
││ Vol.reg ██████░░░░ 62          ││
││ MTF     █████████░ 90          ││
│└────────────────────────────────┘│
│┌─ 9 HISTORY ────────────────────┐│
││ [Win 58%]     [Avg R +0.42]    ││
││ [MaxDD -6.1R]  [n = 64]        ││
││   /\__/\  /\/\_/\/  h80        ││
││ ┌ CGS-0139 ▲L  TP  +1.0R ┐     ││
││ └ 09-27 · 6h            > ┘    ││
││ ┌ CGS-0131 ▼S  SL  -1.0R ┐     ││
││ └ 09-25 · 3h            > ┘    ││
││ [ View all in History ]        ││
│└────────────────────────────────┘│
│┌─ F FOOTER (stacked) ───────────┐│
││ Informational, not fin. advice ││
││ Risk disclaimer · Terms        ││
││ Privacy · Methodology          ││
│└────────────────────────────────┘│
│┌─ B TABS h56+inset ─────────────┐│
││ [Sig*][Mkt][Wlist][Alrt][More] ││
│└────────────────────────────────┘│
└──────────────────────────────────┘
```

### 5.2 Grid and spacing

| Property | Value |
|---|---|
| Columns | **4** |
| Page margin | **16** |
| Gutter | **12** |
| Inner width @390 | 358 → column = (358 − 3×12) / 4 = **80.5**; @360: 328 → 73 |
| Zone gap | **24** · component gap **12** · card padding **12** |
| Top bar | h**48** · banner (DEMO ribbon) h**24** |
| Sticky mini-bar | h**48**, sits under top bar |
| Tab bar | h**56** + safe-area inset · all targets ≥ **44 × 44** |
| Content bottom padding | `56 + inset + 16` |

### 5.3 Placement (columns of 4)

| # | Component | Span | Height | Notes |
|---|---|---|---|---|
| 1 Market | 4 | 136 | row 1: symbol + price 24px; row 2: change chip, regime, freshness; row 3: timeframe chips h44, horizontal scroll, gap 8 |
| 2 Signal | 4 | 136 | row 1 side pill + symbol + status; row 2 strategy · TF · age + `Score 82 >`; row 3 four action buttons, each span 1 (≈80 wide, h44, icon + 12px label) |
| 3 Entry | 2 (173 @390 / 158 @360) | 128 | price 20px mono; zone; distance; validity |
| 4 Risk | 2 | 128 | stop, distance, R:R, invalidation (truncates to 2 lines, tap for full) |
| 5 Targets | 4 | 40 header + rows h40 | one row per target; >3 targets scroll inside card |
| 6 Chart | 4 | toolbar 40 + canvas **280** (min 240) | series chips in toolbar; level legend chips under chart (Entry, SL, TP1–TP3, tap to focus level); Fullscreen opens landscape sheet |
| R1 Risk intel | 4 | accordion header h48 | **open** by default |
| R2 Market intel | 4 | accordion header h48 | **closed** by default |
| R3 Data health | 4 | 40 | chip row: provider · engine · mode |
| 7 Evidence | 4 | auto | tabs h44, horizontal scroll; rows h48 (label, value, ✓/✗ + text) |
| 8 Signal Score | 4 | auto | ring 96 centered → five sub-score rows h40 (name · bar · value) |
| 9 History | 4 | auto | KPI 2×2 (each span 2, h72) → sparkline h80 → **cards not table**: each h72 (row 1 ID · side · outcome · R, row 2 date · duration · chevron) × 5 → `View all in History` button h44 |
| F Footer | 4 | auto | stacked lines, sits above the tab bar |

**Above the fold (390 × 844, with banner):** 24 + 48 + 16 + 136 + 12 + 136 + 12 + 128 + 12 + 160 = **684**; usable height = 844 − 56 (tabs) − 34 (home-indicator inset) = **754**. Market → Targets fully visible; the chart top begins visible.

### 5.4 Mobile behaviours

- **Top bar:** Back (uses in-app history, else breadcrumb parent) · truncated title · search · compact mode badge. Bell and account are reached via Alerts tab and More.
- **Sticky mini-bar:** appears when component 2 scrolls out; shows `▲ LONG · BTC-USDT · Entry 67,420 · Score 82`; tap scrolls to top of Signal. Hides again when component 2 is back in view.
- **Chart gestures:** one-finger horizontal drag pans; vertical drag scrolls the page; pinch zooms; long-press shows crosshair readout; tap legend chip focuses a level.
- **Tabs:** Signals selected; tapping selected tab scrolls to top, second tap returns to `/signals`. Each tab keeps its own back stack.
- Below 360 (not supported), content still reflows without horizontal scroll; freshness text collapses to a dot.

---

## 6. Component order across breakpoints (single source)

| Order | Component | Desktop | Tablet | Mobile |
|---|---|---|---|---|
| 1 | Market | Main, full | full | full |
| 2 | Signal | Main, full | full | full |
| 3 | Entry | Main, 1/3 | 2 of 6 | 2 of 4 |
| 4 | Risk | Main, 1/3 | 2 of 6 | 2 of 4 |
| 5 | Targets | Main, 1/3 | 2 of 6 | 4 of 4 (own row) |
| 6 | Chart | Main, full | full | full |
| — | R1 Risk intel | Rail (beside 1–6) | 3 of 6 | accordion |
| — | R2 Market intel | Rail | 3 of 6 | accordion |
| — | R3 Data health | Rail | strip | chip row |
| 7 | Evidence | Z2 Main track | full | full |
| 8 | Signal Score | Z2 Rail track | full | full |
| 9 | History | Z3 Main track (table) | full (reduced table) | full (cards) |
| — | Performance summary | Z3 Rail track | KPI strip inside 9 | KPI grid inside 9 |

---

## 7. Responsive behaviour summary

| Aspect | ≥1440 | 1280–1439 | 1024–1279 | 640–1023 | 360–639 |
|---|---|---|---|---|---|
| Navigation | sidebar 240 | sidebar 64 | sidebar 64 | bottom tabs 64 | bottom tabs 56 |
| Header | 56, breadcrumbs + search bar | same | search shrinks to 320 | 56, back + title + search icon | 48, back + title + search icon |
| Grid | 2-track | 2-track | 2-track | 6-col | 4-col |
| Rail | 360 right | 360 right | 320 right | in flow (2-up) | in flow (accordions) |
| Page margin | 24 | 24 | 24 | 24 | 16 |
| Entry/Risk/Targets | 3-up | 3-up | 3-up (tight) | 3-up | Entry+Risk 2-up, Targets row |
| Chart canvas | clamp(320, 42vh, 480) | same | same | clamp(320, 36vh, 440) | 280 (min 240) |
| Evidence + Score | side by side | side by side | side by side | stacked | stacked |
| History | table, all columns | table | table | table, reduced | cards |
| Footer | one row, 48 | one row | wraps | 2 lines | stacked |
| Sticky extras | rail (Z1) | rail (Z1) | rail (Z1) | — | signal mini-bar |

Breakpoints reuse `design-system.md` (360, 640, 1024, 1440); 1280 only changes the sidebar default and is not a new layout.

**Reflow rules**
1. Never reorder the hierarchy; only change span, stacking and disclosure.
2. Never hide Entry, Stop, Targets, Score or the mode badge at any size.
3. Content may shrink but text is never below 12px; reflow (no horizontal page scroll) at 200% zoom.
4. Tables become cards only on mobile; tablet keeps a reduced table.

---

## 8. States

| State | Behaviour (all sizes) |
|---|---|
| **Loading** | skeleton per component at its exact height (no layout shift); nav stays interactive |
| **Signal open** | as drawn; Entry chip shows waiting / triggered |
| **Signal closed** | Signal status chip shows outcome (TP / SL / expired); Targets show ✓ hit; chart adds exit marker; Evidence › Lifecycle expands |
| **Stale data / engine paused** | status slot banner under header; Market freshness dot turns warning + icon; Entry/Risk/Targets values stay visible but labeled "not updating" |
| **Mode DEMO / LIVE** | banner slot filled; mode badge always in header (compact on mobile) |
| **Locked action (anonymous)** | Watchlist/Alert/Backtest buttons show lock cue; press → `/login?returnTo=…` |
| **Signal not found** | area-scoped 404 within Signals shell (never global); forbidden also renders 404 |
| **Missing data** | "—" with reason on hover/focus/tap; never blank, never zero |

---

## 9. Layout constants (CSS custom properties)

| Property | Desktop | Tablet | Mobile |
|---|---|---|---|
| `--banner-h` | 32 / 0 | 32 / 0 | 24 / 0 |
| `--header-h` | 56 | 56 | 48 |
| `--sidebar-w` | 240 / 64 | 0 | 0 |
| `--rail-w` | 360 (320 @1024–1279) | n/a | n/a |
| `--tabbar-h` | 0 | 64 | 56 |
| `--page-pad` | 24 | 24 | 16 |
| `--gap-zone` | 24 | 24 | 24 |
| `--gap-card` | 16 | 16 | 12 |
| `--card-pad` | 16 | 16 | 12 |
| `--footer-h` | 48 | auto | auto |

---

## 10. Acceptance checklist

- [ ] Hierarchy order Market → Signal → Entry → Risk → Targets → Chart → Evidence → Signal Score → History holds in DOM, tab order and visual flow at every breakpoint.
- [ ] Desktop contains all seven regions: header, left navigation, main signal area, right intelligence/risk area, lower analysis area, history/performance area, footer.
- [ ] Desktop 1440: 240 + 24 + 768 + 24 + 360 + 24 = 1440.
- [ ] Tablet 768: 6-col, margin 24, gutter 16; Entry/Risk/Targets 229.33 each.
- [ ] Mobile 390: 4-col, margin 16, gutter 12; Entry/Risk 173 each.
- [ ] Mode badge, risk notice and Risk disclaimer link visible on every size.
- [ ] Navigation matches `DESKTOP_NAV` (sidebar) and `MOBILE_TABS` / `MOBILE_MORE` (tabs) exactly.
- [ ] Tap targets ≥ 44 × 44 on tablet and mobile; focus ring 2px `accent.brand`.
