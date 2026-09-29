# CoinGabbarSignals Header (Part 06A-1: foundation + branding)

Independent component: `src/components/signals-header/` (`SignalsHeader.tsx`, `BrandMark.tsx`, `header.css`).
Tokens: `tokens.header` in `shared/designTokens.ts` → `--header-*` in `src/styles/tokens.css` (`npm run tokens:build`).

## Areas (DOM order = tab order)
`brand` · `nav` · `utility`. Only brand has content. `nav` and `utility` are empty containers fed by the optional `navigation` / `utility` props, reserved for: navigation, search, market status, notifications, theme, account, mobile nav.

## States
| State | Width | Height | Layout |
|---|---|---|---|
| Desktop | ≥1024 | 56 | grid `auto 1fr auto`, brand + "Signal terminal" descriptor, nav area visible |
| Tablet | 640–1023 | 56 | grid `1fr auto`, nav area collapsed, 44px touch controls |
| Mobile | <640 | 48 | grid `1fr auto`, stacked compact brand, 16px padding, 44px touch controls |

## Public layout contract
`--header-h` (sticky offsets), `--header-pad-x`, `--header-control`. Sticky `top` is `var(--banner-h, 0px)`.
Layers: `--header-z-index` 100, `--header-z-index-floating` 110 (future dropdowns/overlays).

## Rules
Header CSS may use only `--header-*` variables: no color literals and no raw lengths (enforced by `tests/header.test.ts`). Media-query widths must match `breakpoints` (640 / 1024).
