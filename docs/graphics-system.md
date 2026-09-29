# CoinGabbarSignals — Brand + Graphics System (Part 05)

Built from scratch on the Part 04 tokens. **Source:** `scripts/graphics/*` → `npm run graphics:build` → `assets/`. Tests in `tests/graphics.test.ts` keep files, manifest, and palette in sync.

## 1. Brand mark
**Concept:** a "G" drawn as one open ring. The crossbar points inward, and a small green **signal node** sits in the ring's opening: the moment a signal fires.
- Geometry: 64 grid, ring radius 22, 6 stroke, round caps; opening spans 48° on the upper right; node r = 3.6.
- Color: ring uses `gradient.accent` (Ion Indigo → Orchid); node is `positive`. The node is the only green in the brand.
- Variants (`assets/brand/`): `mark` (dark surfaces), `mark-mono` (currentColor), `mark-ink` (light surfaces), `wordmark`, `lockup-horizontal` (default logo), `lockup-stacked`, `favicon` (readable at 16px), `app-icon` (512, inside the maskable safe zone), `og-image` (1200×630).
- Wordmark: "CoinGabbar" in text color + "Signals" in `accent.primary`, Space Grotesk Bold outlined to paths (no font dependency).
- **Clear space:** ≥ ½ mark height on all sides. **Minimum size:** mark 16px, horizontal logo 120px wide, stacked 96px wide.
- **Don't:** recolor the node, stretch, add shadows/outlines, place the color mark on `accent` fills, or use the node color for anything but "live/positive".

## 2. Icon system
- 24px grid, 1.75 stroke, round caps/joins, `currentColor`, no fills except small dots. Live area 2–22px. Authored in-house.
- **Usage:** icons must be **inlined** (import with `?raw`, an SVG component, or `sprite.svg` + `<use>`). `<img src>` cannot inherit `currentColor`. Set color via `color: var(--color-...)`; sizes 16 / 20 / 24 / 32.
- Signal-state icons are **shape-distinct, not color-distinct**: ▲ long, ▼ short, ⊕ buy, ⊖ sell, dashed-ring active, hourglass wait, slashed circle no-trade, arrow-to-line entry, floor + ✕ stop loss, level + ✓ take profit. Always pair with a text label.
- Recommended color pairing: long/buy/take-profit → `positive`; short/sell/stop-loss → `negative`; wait/risk → `warning`; no-trade → `neutral`; active/entry → `accent.primary`.

| Set | Folder | Icons |
|---|---|---|
| Product | `icons/` | signal, risk, market, volume, derivatives, liquidity, news, alert, watchlist, backtest, performance, tool |
| Status | `icons/` | search, warning, offline, lock, pause, help, close |
| Signal states | `signals/` | long, short, buy, sell, active, wait, no-trade, entry, stop-loss, take-profit |

## 3. Chart graphics (`assets/charts/`)
- **Placeholders (decorative, not data):** candles, candles-skeleton (loading), equity-curve, depth-chart, volume-bars, sparkline-up/down/flat.
- **Templates:** price-ladder (TP3 → TP1, entry, stop with tinted profit/risk zones), score-ring (82%), confidence-meter (4 of 5).
- **Tiles:** grid-tile (48px), dot-grid-tile (24px) for `background-image`.
- **Chart markers (20px):** entry, stop, target, signal-candle. Wireframe overlays use these; markers never repaint.
- Real charts render from data at runtime; these assets are for empty/loading/marketing states only.

## 4. Illustrations (`assets/illustrations/`, 480×360, transparent background)
**Style:** one dark "terminal window" panel, a floating circular status badge (icon in tone color), dotted-grid halo, tone-colored glow. Tone tells the story: indigo = neutral/setup, grey = nothing to show, amber = degraded, red = failed.
- **Empty (8):** no-signals, no-trade, no-watchlist, no-alerts, no-history, no-backtests, no-results, no-news.
- **Data error (8):** data-load, connection-lost, provider-unavailable, stale-data, rate-limited, not-found, access-locked, engine-paused.
- Copy lives in the UI, never in the SVG (no text is embedded). Each file has `<title>` and `<desc>`; use `alt=""` when the surrounding heading already says the same thing.
- **No trade** is a valid product state, not an error: it uses the neutral tone and the no-trade icon.

## 5. Rules
1. Colors in any asset must come from `shared/designTokens.ts` (tests fail on any other hex, on `rgb()/hsl()`, and on Part 01 draft colors).
2. No `<text>`, scripts, external references, or embedded bitmaps.
3. Edit generators, not SVG files; commit generated output.
4. Never convey meaning by color alone: pair with icon shape and a label.
5. Preview everything at `assets/preview.html`.

## 6. Not included (by design)
Raster exports (PNG/ICO), font files, motion/Lottie, and any UI components. Build-time PNG export for the app icon and social card can be added when deployment is set up.
