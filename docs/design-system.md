# CoinGabbarSignals — Design System (Part 04) · "Obsidian Terminal"

Supersedes the Part 01 draft. **No color, font, or component from legacy CoinGabbar or the Part 01 draft is reused** (a test enforces the palette).

**Source of truth:** `shared/designTokens.ts` → generated `src/styles/tokens.css` (`npm run tokens:build`). Base rules: `src/styles/base.css`.
**Law:** all UI consumes `var(--token)`. No hex/rgb/hsl in `src/` outside `tokens.css` (enforced by `tests/design-tokens.test.ts`).

## Principles
1. Signal first · 2. Mode always visible (DEMO/PAPER/LIVE) · 3. Calm density · 4. Never color-only meaning (pair ▲/▼, ✓/✗, text) · 5. WCAG 2.2 AA · 6. Designed from 360px.

## Color
| Role | Token | Value |
|---|---|---|
| Primary background | `--color-bg-primary` | `#07080D` |
| Secondary background | `--color-bg-secondary` | `#0C0E15` |
| Panel background | `--color-bg-panel` | `#11141D` |
| Elevated panel | `--color-bg-elevated` | `#181C28` |
| Border (hairline / default / control) | `--color-border-subtle` / `-default` / `-strong` | `#1A1F2D` / `#242A3B` / `#5F6888` |
| Primary accent (Ion Indigo) | `--color-accent-primary` (+`-hover` `#93A0FF`, `-active` `#6572F0`, `-subtle`, `--color-accent-on-primary`) | `#7B88FF` |
| Secondary accent (Orchid) | `--color-accent-secondary` (+`-hover`, `-subtle`) | `#C99BFF` |
| Positive | `--color-positive-base` / `-subtle` / `-edge` | `#3BE39A` |
| Negative | `--color-negative-base` / `-subtle` / `-edge` | `#FF5C7C` |
| Warning | `--color-warning-base` / `-subtle` / `-edge` | `#FFC25A` |
| Neutral | `--color-neutral-base` / `-subtle` / `-edge` | `#8E98B5` |
| Text / muted / disabled | `--color-text-primary` / `-muted` / `-disabled` | `#E9ECF5` / `#9CA3BA` / `#5A6178` |
| Mode badges | `--color-mode-demo` / `-paper` / `-live` | `#C99BFF` / `#56C8F5` / `#FF8747` |
| Focus ring | `--color-focus-ring` | `#A9B2FF` |

Also: `--color-bg-overlay` (scrim), `--color-bg-disabled`, `--color-border-disabled`, `--color-text-inverse`.
Usage: long/profit = positive, short/loss = negative, pending/caution = warning, inactive/unknown = neutral. `subtle` = tinted fills (chips, row highlights), `edge` = tinted 1px borders.
Verified: every text/semantic color ≥ 4.5:1 on all four surfaces; focus ring and `border-strong` ≥ 3:1. `text-disabled` is exempt and never carries essential information.

## Typography
Families: display **Space Grotesk**, body **IBM Plex Sans**, numbers **IBM Plex Mono** (system fallbacks in tokens; self-hosted font files go in `/assets`, none are loaded yet).

| Style | Size / line | Weight | Tracking | Family |
|---|---|---|---|---|
| `display` | 40 / 44 | 700 | -0.02em | display |
| `h1` | 28 / 34 | 700 | -0.015em | display |
| `h2` | 22 / 28 | 600 | -0.01em | display |
| `h3` | 18 / 24 | 600 | -0.005em | display |
| `body` | 14 / 22 | 400 | 0 | body |
| `small` | 12 / 16 | 400 | 0.01em | body |
| `numerical` | 13 / 18 | 500 | 0 | mono |
| `market-price` | 28 / 32 | 600 | -0.01em | mono |
| `signal-status` | 12 / 16 | 600 | 0.08em, UPPERCASE | body |

Variables: `--type-<style>-{size,line,weight,tracking,family}`. All numerics use `font-variant-numeric: tabular-nums` (`.num` / `[data-numeric]` in base.css), right-aligned, fixed decimals per instrument tick size. Below 640px, `display` steps down to `h1`.

## Spacing · Radius
Spacing (4px base): `--space-0` 0 · `half` 2 · `1` 4 · `2` 8 · `3` 12 · `4` 16 · `5` 20 · `6` 24 · `8` 32 · `10` 40 · `12` 48 · `16` 64 · `20` 80.
Radius: `none` 0 · `xs` 2 · `sm` 4 (chips, badges) · `md` 6 (controls) · `lg` 10 (panels) · `xl` 16 (modals) · `pill` 999.

## Shadows · Gradients
Shadows (`--shadow-*`): `xs` `sm` `md` `lg` `overlay` (popovers/modals), `inset-highlight` (panel top edge), `glow-accent` / `glow-positive` / `glow-negative` (selected or triggered signal only), `focus-ring` (for clipped containers). Panels stay flat: border first, shadow only for floating layers.
Gradients (`--gradient-*`): `canvas` (page glow), `panel-sheen`, `accent` (indigo→orchid, brand moments and primary CTA only), `accent-subtle`, `positive-fill` / `negative-fill` (chart area fills), `skeleton`.

## Motion
Durations: `instant` 80 · `fast` 120 (hover, color) · `base` 180 (menus, panels) · `slow` 260 (modals, sheets) · `tick` 700 (price flash). Easing: `standard`, `enter`, `exit`, `linear`. Presets: `--motion-transition-{colors,elevation,overlay}`.
Rules:
1. Animate only `opacity`, `transform`, color, background, border, shadow. Never width/height/top/left.
2. Motion conveys change or state, never decoration. No looping animation except the LIVE pulse dot (2s) and skeletons.
3. Price ticks flash `positive-subtle` / `negative-subtle` for `tick`, then settle; direction is also shown by ▲/▼ or sign.
4. Enter uses `ease-enter`, exit uses `ease-exit` and is faster than enter.
5. `prefers-reduced-motion`: durations → 0, transitions off, no flashes or shimmer (tokens.css + base.css handle this).

## Interaction states
| State | Rule |
|---|---|
| Hover (surface, row, nav item) | overlay `--color-state-hover`; cursor pointer only if actionable |
| Hover (primary button) | fill → `accent-primary-hover`; secondary/ghost: `state-hover` + border → `border-strong` |
| Pressed | `--color-state-pressed`; primary → `accent-primary-active`; no scale/bounce |
| Selected | `--color-state-selected` fill + 1px `--color-state-selected-edge` border |
| Focus (keyboard) | `:focus-visible` → 2px `--color-focus-ring`, 2px offset; where clipped use `--shadow-focus-ring`. Never remove without replacement |
| Disabled | `text-disabled` on `bg-disabled`, `border-disabled`, `cursor: not-allowed`; no hover effect |
| Loading | `--gradient-skeleton` shimmer (static under reduced motion) |

## Signal and mode conventions
Long = positive + ▲ + "LONG"; short = negative + ▼ + "SHORT"; pending = warning; expired/closed = neutral. Status text uses `signal-status`. LIVE adds a persistent top bar in `--color-mode-live`; DEMO adds a "simulated data" ribbon in `--color-mode-demo`.

## Migration from Part 01 names
`bg.canvas`→`--color-bg-primary` · `bg.surface`→`--color-bg-panel` · `bg.raised`→`--color-bg-elevated` · `border.subtle`→`--color-border-default` (hairline: `-subtle`) · `text.primary/muted`→`--color-text-primary/-muted` · `accent.brand`→`--color-accent-primary` · `signal.long/short/neutral`→`--color-positive/negative/warning-base` · `mode.*`→`--color-mode-*`. Wireframe **layout** numbers (heights, spans, gaps, radius 6/10) are unchanged; only their token names are remapped.

## Graphics
Brand mark, icons, chart assets and illustrations: see `docs/graphics-system.md`.

## Rules
- Tokens only; add a new token in `shared/designTokens.ts`, run `npm run tokens:build`, commit both files.
- Contrast ≥ 4.5:1 text, ≥ 3:1 UI boundaries and focus; tests fail the build otherwise.
- Prices right-aligned, mono, tabular. Assets live in `/assets`.
