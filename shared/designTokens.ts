/**
 * CoinGabbarSignals design tokens — "Obsidian Terminal".
 *
 * SINGLE SOURCE OF TRUTH. Raw color values (hex/rgb/hsl) may exist ONLY in this
 * file and in the generated src/styles/tokens.css. All UI must consume the CSS
 * custom properties (var(--color-...)) or the typed helpers below.
 *
 * Regenerate CSS after any change: npm run tokens:build
 * Nothing here is carried over from legacy CoinGabbar or from the Part 01 draft.
 */

/** Breakpoints (px). CSS variables cannot be used in @media queries, so these are TS-only. */
export const breakpoints = { xs: 360, sm: 640, md: 1024, lg: 1440 } as const;

export const tokens = {
  color: {
    bg: {
      primary: "#07080D", // app canvas
      secondary: "#0C0E15", // sidebar, top bar, page bands
      panel: "#11141D", // cards, tables
      elevated: "#181C28", // popovers, menus, modals
      overlay: "rgba(4, 5, 9, 0.72)", // modal scrim
      disabled: "#0E1119",
    },
    border: {
      subtle: "#1A1F2D", // hairline dividers inside panels
      default: "#242A3B", // panel edges
      strong: "#5F6888", // control boundaries (>= 3:1 on panels)
      disabled: "#1D2231",
    },
    accent: {
      primary: "#7B88FF", // Ion Indigo
      primaryHover: "#93A0FF",
      primaryActive: "#6572F0",
      primarySubtle: "rgba(123, 136, 255, 0.14)",
      onPrimary: "#06070C", // text/icons on primary accent fills
      secondary: "#C99BFF", // Orchid
      secondaryHover: "#D8B5FF",
      secondarySubtle: "rgba(201, 155, 255, 0.14)",
    },
    positive: { base: "#3BE39A", subtle: "rgba(59, 227, 154, 0.14)", edge: "rgba(59, 227, 154, 0.40)" },
    negative: { base: "#FF5C7C", subtle: "rgba(255, 92, 124, 0.14)", edge: "rgba(255, 92, 124, 0.40)" },
    warning: { base: "#FFC25A", subtle: "rgba(255, 194, 90, 0.14)", edge: "rgba(255, 194, 90, 0.40)" },
    neutral: { base: "#8E98B5", subtle: "rgba(142, 152, 181, 0.14)", edge: "rgba(142, 152, 181, 0.40)" },
    mode: {
      demo: "#C99BFF",
      paper: "#56C8F5",
      live: "#FF8747",
    },
    text: {
      primary: "#E9ECF5",
      muted: "#9CA3BA",
      disabled: "#5A6178", // exempt from contrast rules (inactive); never for essential info
      inverse: "#06070C",
    },
    focus: { ring: "#A9B2FF" },
    state: {
      hover: "rgba(233, 236, 245, 0.05)", // overlay on any surface
      pressed: "rgba(233, 236, 245, 0.09)",
      selected: "rgba(123, 136, 255, 0.14)",
      selectedEdge: "rgba(123, 136, 255, 0.55)",
    },
  },

  font: {
    family: {
      display: `"Space Grotesk", "Segoe UI", system-ui, sans-serif`,
      body: `"IBM Plex Sans", "Segoe UI", system-ui, sans-serif`,
      mono: `"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`,
    },
    weight: { regular: "400", medium: "500", semibold: "600", bold: "700" },
  },

  /** Composite text styles. Each becomes --type-<name>-<prop> variables. */
  type: {
    display: { size: "2.5rem", line: "2.75rem", weight: "700", tracking: "-0.02em", family: "display" },
    h1: { size: "1.75rem", line: "2.125rem", weight: "700", tracking: "-0.015em", family: "display" },
    h2: { size: "1.375rem", line: "1.75rem", weight: "600", tracking: "-0.01em", family: "display" },
    h3: { size: "1.125rem", line: "1.5rem", weight: "600", tracking: "-0.005em", family: "display" },
    body: { size: "0.875rem", line: "1.375rem", weight: "400", tracking: "0", family: "body" },
    small: { size: "0.75rem", line: "1rem", weight: "400", tracking: "0.01em", family: "body" },
    numerical: { size: "0.8125rem", line: "1.125rem", weight: "500", tracking: "0", family: "mono" },
    marketPrice: { size: "1.75rem", line: "2rem", weight: "600", tracking: "-0.01em", family: "mono" },
    signalStatus: { size: "0.75rem", line: "1rem", weight: "600", tracking: "0.08em", family: "body" },
  },

  space: {
    "0": "0px",
    half: "2px",
    "1": "4px",
    "2": "8px",
    "3": "12px",
    "4": "16px",
    "5": "20px",
    "6": "24px",
    "8": "32px",
    "10": "40px",
    "12": "48px",
    "16": "64px",
    "20": "80px",
  },

  radius: {
    none: "0px",
    xs: "2px",
    sm: "4px", // badges, chips, table cells
    md: "6px", // buttons, inputs, nav items
    lg: "10px", // panels, cards
    xl: "16px", // modals, sheets
    pill: "999px",
  },

  shadow: {
    none: "none",
    xs: "0 1px 2px rgba(0, 0, 0, 0.45)",
    sm: "0 2px 6px rgba(0, 0, 0, 0.5)",
    md: "0 8px 20px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(233, 236, 245, 0.04)",
    lg: "0 16px 40px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(233, 236, 245, 0.06)",
    overlay: "0 24px 64px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(233, 236, 245, 0.08)",
    insetHighlight: "inset 0 1px 0 rgba(233, 236, 245, 0.05)",
    glowAccent: "0 0 0 1px rgba(123, 136, 255, 0.55), 0 0 24px rgba(123, 136, 255, 0.28)",
    glowPositive: "0 0 0 1px rgba(59, 227, 154, 0.5), 0 0 20px rgba(59, 227, 154, 0.22)",
    glowNegative: "0 0 0 1px rgba(255, 92, 124, 0.5), 0 0 20px rgba(255, 92, 124, 0.22)",
    focusRing: "0 0 0 2px #07080D, 0 0 0 4px #A9B2FF",
  },

  gradient: {
    canvas: "radial-gradient(1200px 600px at 50% -200px, rgba(123, 136, 255, 0.10), rgba(7, 8, 13, 0) 70%)",
    panelSheen: "linear-gradient(180deg, rgba(233, 236, 245, 0.035), rgba(233, 236, 245, 0) 48%)",
    accent: "linear-gradient(135deg, #7B88FF 0%, #C99BFF 100%)",
    accentSubtle: "linear-gradient(135deg, rgba(123, 136, 255, 0.18), rgba(201, 155, 255, 0.10))",
    positiveFill: "linear-gradient(180deg, rgba(59, 227, 154, 0.28), rgba(59, 227, 154, 0))",
    negativeFill: "linear-gradient(180deg, rgba(255, 92, 124, 0.28), rgba(255, 92, 124, 0))",
    skeleton: "linear-gradient(90deg, #11141D 0%, #1B2030 50%, #11141D 100%)",
  },

  motion: {
    duration: { instant: "80ms", fast: "120ms", base: "180ms", slow: "260ms", tick: "700ms" },
    ease: {
      standard: "cubic-bezier(0.2, 0, 0, 1)",
      enter: "cubic-bezier(0, 0, 0.2, 1)",
      exit: "cubic-bezier(0.4, 0, 1, 1)",
      linear: "linear",
    },
    transition: {
      colors:
        "color 120ms cubic-bezier(0.2, 0, 0, 1), background-color 120ms cubic-bezier(0.2, 0, 0, 1), border-color 120ms cubic-bezier(0.2, 0, 0, 1)",
      elevation: "box-shadow 180ms cubic-bezier(0.2, 0, 0, 1), transform 180ms cubic-bezier(0.2, 0, 0, 1)",
      overlay: "opacity 180ms cubic-bezier(0, 0, 0.2, 1), transform 180ms cubic-bezier(0, 0, 0.2, 1)",
    },
  },

  /**
   * CoinGabbarSignals header layer (Part 06A-1). Every header component consumes
   * these `--header-*` variables; values alias the core tokens above, so nothing
   * here introduces a raw color. Responsive "active" values are resolved in
   * src/components/signals-header/header.css.
   */
  header: {
    // Dimensions
    height: "56px",
    heightMobile: "48px",
    containerMax: "1920px",
    paddingInline: "var(--space-6)",
    paddingInlineMobile: "var(--space-4)",
    gap: "var(--space-4)",
    gapMobile: "var(--space-2)",
    borderWidth: "1px",
    // Color roles
    bg: "var(--color-bg-secondary)",
    surface: "var(--color-bg-panel)",
    surfaceHover: "var(--color-state-hover)",
    border: "var(--color-border-default)",
    text: "var(--color-text-primary)",
    textMuted: "var(--color-text-muted)",
    accent: "var(--color-accent-primary)",
    accentSecondary: "var(--color-accent-secondary)",
    statusPositive: "var(--color-positive-base)",
    statusNegative: "var(--color-negative-base)",
    statusWarning: "var(--color-warning-base)",
    focusRing: "var(--color-focus-ring)",
    focusWidth: "2px",
    focusOffset: "2px",
    // Typography
    fontBrand: "var(--font-family-display)",
    fontBody: "var(--font-family-body)",
    brandSize: "1.125rem",
    brandSizeMobile: "0.8125rem",
    brandLine: "1.25rem",
    brandLineMobile: "0.875rem",
    brandWeight: "var(--font-weight-bold)",
    brandTracking: "-0.015em",
    tagSize: "0.6875rem",
    tagLine: "1rem",
    tagWeight: "var(--font-weight-semibold)",
    tagTracking: "0.12em",
    // Shape, elevation, icon, motion
    radius: "var(--radius-md)",
    shadow: "var(--shadow-inset-highlight)",
    shadowFloating: "var(--shadow-md)",
    iconSize: "20px",
    markSize: "28px",
    markSizeMobile: "26px",
    controlSize: "36px",
    controlSizeTouch: "44px",
    transition: "var(--motion-transition-colors)",
    // Layers (banner slot sits above the header, floating panels above both)
    zIndex: "100",
    zIndexFloating: "110",
    // Breakpoints, mirrored for JS/debugging only (media queries use the TS values)
    breakpointTablet: `${breakpoints.sm}px`,
    breakpointDesktop: `${breakpoints.md}px`,
  },
} as const;

// ---------------------------------------------------------------------------
// CSS generation helpers
// ---------------------------------------------------------------------------

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

type Leaf = string;
interface Tree {
  [key: string]: Leaf | Tree;
}

function flatten(tree: Tree, prefix: string[], out: Array<[string, string]>) {
  for (const [key, value] of Object.entries(tree)) {
    const path = [...prefix, kebab(key)];
    if (typeof value === "string") out.push([`--${path.join("-")}`, value]);
    else flatten(value, path, out);
  }
}

/** Ordered list of [cssVariableName, value] for every token. */
export function tokenEntries(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const { type, ...rest } = tokens;
  flatten(rest as unknown as Tree, [], out);

  for (const [name, style] of Object.entries(type)) {
    const base = `--type-${kebab(name)}`;
    out.push([`${base}-size`, style.size]);
    out.push([`${base}-line`, style.line]);
    out.push([`${base}-weight`, style.weight]);
    out.push([`${base}-tracking`, style.tracking]);
    out.push([`${base}-family`, `var(--font-family-${style.family})`]);
  }
  out.push(["--type-numeric-features", `"tnum" 1, "zero" 1`]);
  return out;
}

/** Typed accessor: cssVar("color-bg-panel") -> "var(--color-bg-panel)". */
export const cssVar = (name: string) => `var(--${name})`;

/** Full contents of src/styles/tokens.css. */
export function renderTokensCss(): string {
  const lines = tokenEntries().map(([k, v]) => `  ${k}: ${v};`);
  return `/* GENERATED by scripts/generate-tokens-css.ts from shared/designTokens.ts — DO NOT EDIT. */
:root {
  color-scheme: dark;
${lines.join("\n")}
}

/* Motion rule: users who prefer reduced motion get instant state changes. */
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-duration-instant: 0ms;
    --motion-duration-fast: 0ms;
    --motion-duration-base: 0ms;
    --motion-duration-slow: 0ms;
    --motion-duration-tick: 0ms;
    --motion-transition-colors: none;
    --motion-transition-elevation: none;
    --motion-transition-overlay: none;
  }
}
`;
}
