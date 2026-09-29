/**
 * CoinGabbarSignals route registry — the single source of truth for the product IA.
 * Pure data + pure helpers. No UI, no framework imports. Consumed by web, server and docs tooling.
 */
export const AREA_IDS = [
  "signals",
  "signal-detail",
  "history",
  "performance",
  "backtesting",
  "watchlist",
  "market",
  "tools",
  "alerts",
  "academy",
  "methodology",
  "settings",
  "risk-disclaimer",
] as const;
export type AreaId = (typeof AREA_IDS)[number];
/** Signal Detail is a major area but has no nav item of its own; it highlights "Signals". */
export type NavItemId = Exclude<AreaId, "signal-detail">;
export type Access = "public" | "authenticated";
/** app = full shell with navigation; focus = task flow, nav collapsed; reading = long-form content; auth = minimal. */
export type Layout = "app" | "focus" | "reading" | "auth";

export interface RouteDef {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  /** Breadcrumb label. `{param}` placeholders are filled from route params or replaced by an entity title. */
  readonly crumb: string;
  readonly area: AreaId | "system";
  readonly parent: string | null;
  /** Alternate parent chains keyed by the `origin` query value (origin-aware breadcrumbs). */
  readonly altParents?: Readonly<Record<string, string>>;
  readonly access: Access;
  readonly layout: Layout;
  readonly activeNav: NavItemId | null;
  readonly indexable: boolean;
  /** The complete list of query params this route understands. */
  readonly query?: readonly string[];
  /** Route id this route redirects to. */
  readonly redirectTo?: string;
  /** Route ids that pages on this route should link to. */
  readonly related?: readonly string[];
  readonly summary: string;
}

export const ROUTES = [
  // ───────────── System ─────────────
  { id: "home", path: "/", title: "Home", crumb: "Home", area: "system", parent: null, access: "public", layout: "app", activeNav: null, indexable: false, redirectTo: "signals", summary: "Entry point. Redirects to Signals." },
  { id: "login", path: "/login", title: "Log in", crumb: "Log in", area: "system", parent: null, access: "public", layout: "auth", activeNav: null, indexable: false, query: ["returnTo"], summary: "Sign in. Authenticated visitors are redirected to Signals." },
  { id: "signup", path: "/signup", title: "Create account", crumb: "Create account", area: "system", parent: null, access: "public", layout: "auth", activeNav: null, indexable: false, query: ["returnTo"], summary: "Registration. Requires acknowledging the Risk Disclaimer." },
  { id: "logout", path: "/logout", title: "Log out", crumb: "Log out", area: "system", parent: null, access: "public", layout: "auth", activeNav: null, indexable: false, redirectTo: "signals", summary: "Action route. Ends the session, then redirects to Signals." },
  { id: "terms", path: "/terms", title: "Terms of Service", crumb: "Terms", area: "system", parent: null, access: "public", layout: "reading", activeNav: null, indexable: true, summary: "Legal terms. Footer link only." },
  { id: "privacy", path: "/privacy", title: "Privacy Policy", crumb: "Privacy", area: "system", parent: null, access: "public", layout: "reading", activeNav: null, indexable: true, summary: "Privacy policy. Footer link only." },
  { id: "not-found", path: "*", title: "Page not found", crumb: "Not found", area: "system", parent: null, access: "public", layout: "app", activeNav: null, indexable: false, related: ["signals", "market", "academy"], summary: "Fallback for unmatched URLs. Offers search and top areas." },

  // ───────────── 1. Signals ─────────────
  { id: "signals", path: "/signals", title: "Signals", crumb: "Signals", area: "signals", parent: null, access: "public", layout: "app", activeNav: "signals", indexable: false, query: ["status", "side", "tf", "instrument", "strategy", "minConf", "sort", "mode"], related: ["history", "watchlist", "alerts", "methodology-scoring"], summary: "Live feed of open and recent signals with filters." },

  // ───────────── 2. Signal Detail ─────────────
  { id: "signal-detail", path: "/signals/:signalId", title: "Signal detail", crumb: "Signal {signalId}", area: "signal-detail", parent: "signals", altParents: { history: "history", watchlist: "watchlist", alerts: "alerts-triggered" }, access: "public", layout: "app", activeNav: "signals", indexable: false, query: ["mode", "origin"], related: ["market-symbol", "methodology-strategy", "tools-position-size", "tools-risk-reward", "alerts-new", "backtest-new", "watchlist", "risk-disclaimer"], summary: "Full signal: levels, confidence breakdown, rationale, lifecycle events, outcome." },

  // ───────────── 3. Signal History ─────────────
  { id: "history", path: "/history", title: "Signal history", crumb: "History", area: "history", parent: null, access: "public", layout: "app", activeNav: "history", indexable: false, query: ["since", "until", "status", "outcome", "instrument", "strategy", "side", "cursor", "mode"], related: ["performance", "signal-detail"], summary: "Searchable archive of all closed and expired signals with outcomes." },

  // ───────────── 4. Performance ─────────────
  { id: "performance", path: "/performance", title: "Performance", crumb: "Performance", area: "performance", parent: null, access: "public", layout: "app", activeNav: "performance", indexable: false, query: ["period", "strategy", "mode"], related: ["performance-strategies", "history", "methodology-performance"], summary: "Aggregate results: win rate, average R, drawdown, equity curve." },
  { id: "performance-strategies", path: "/performance/strategies", title: "Performance by strategy", crumb: "Strategies", area: "performance", parent: "performance", access: "public", layout: "app", activeNav: "performance", indexable: false, query: ["period", "sort", "mode"], related: ["methodology-strategies"], summary: "Comparison table of all strategies." },
  { id: "performance-strategy", path: "/performance/strategies/:strategyKey", title: "Strategy performance", crumb: "{strategyKey}", area: "performance", parent: "performance-strategies", access: "public", layout: "app", activeNav: "performance", indexable: false, query: ["period", "mode"], related: ["methodology-strategy", "history", "backtest-new"], summary: "One strategy's results over time, by instrument and timeframe." },

  // ───────────── 5. Backtesting ─────────────
  { id: "backtesting", path: "/backtesting", title: "Backtesting", crumb: "Backtesting", area: "backtesting", parent: null, access: "authenticated", layout: "app", activeNav: "backtesting", indexable: false, related: ["backtest-new", "methodology-performance"], summary: "The user's saved backtest runs." },
  { id: "backtest-new", path: "/backtesting/new", title: "New backtest", crumb: "New", area: "backtesting", parent: "backtesting", access: "authenticated", layout: "focus", activeNav: "backtesting", indexable: false, query: ["strategy", "instrument", "tf", "since", "until", "signalId"], summary: "Configure and start a backtest. Supports prefill from a signal or strategy." },
  { id: "backtest-run", path: "/backtesting/:runId", title: "Backtest result", crumb: "Run {runId}", area: "backtesting", parent: "backtesting", access: "authenticated", layout: "app", activeNav: "backtesting", indexable: false, related: ["backtest-new", "methodology-strategy"], summary: "Result of one run: metrics, equity curve, trade list." },

  // ───────────── 6. Watchlist ─────────────
  { id: "watchlist", path: "/watchlist", title: "Watchlist", crumb: "Watchlist", area: "watchlist", parent: null, access: "authenticated", layout: "app", activeNav: "watchlist", indexable: false, related: ["market", "alerts-new"], summary: "The user's default list with live prices and open-signal indicators." },
  { id: "watchlist-detail", path: "/watchlist/:listId", title: "Watchlist", crumb: "{listId}", area: "watchlist", parent: "watchlist", access: "authenticated", layout: "app", activeNav: "watchlist", indexable: false, summary: "A specific named list." },

  // ───────────── 7. Market Analysis ─────────────
  { id: "market", path: "/market", title: "Market analysis", crumb: "Market", area: "market", parent: null, access: "public", layout: "app", activeNav: "market", indexable: false, query: ["tf", "mode"], related: ["market-screener", "signals"], summary: "Market overview: breadth, trend regime, volatility, top movers." },
  { id: "market-screener", path: "/market/screener", title: "Screener", crumb: "Screener", area: "market", parent: "market", access: "public", layout: "app", activeNav: "market", indexable: false, query: ["q", "minVolume", "trend", "tf", "sort"], summary: "Filterable instrument table." },
  { id: "market-symbol", path: "/market/:symbol", title: "Instrument analysis", crumb: "{symbol}", area: "market", parent: "market", access: "public", layout: "app", activeNav: "market", indexable: false, query: ["tf", "mode"], related: ["signals", "alerts-new", "watchlist"], summary: "Chart, levels, indicators and signals for one instrument." },

  // ───────────── 8. Trading Tools ─────────────
  { id: "tools", path: "/tools", title: "Trading tools", crumb: "Tools", area: "tools", parent: null, access: "public", layout: "app", activeNav: "tools", indexable: true, summary: "Index of calculators." },
  { id: "tools-position-size", path: "/tools/position-size", title: "Position size calculator", crumb: "Position size", area: "tools", parent: "tools", access: "public", layout: "app", activeNav: "tools", indexable: true, query: ["side", "entry", "stop", "riskPct", "balance", "signalId"], related: ["tools-risk-reward", "academy-glossary"], summary: "Size a position from account balance and risk %." },
  { id: "tools-risk-reward", path: "/tools/risk-reward", title: "Risk/reward calculator", crumb: "Risk/reward", area: "tools", parent: "tools", access: "public", layout: "app", activeNav: "tools", indexable: true, query: ["side", "entry", "stop", "target", "signalId"], summary: "Compute R:R from entry, stop and target." },
  { id: "tools-profit-loss", path: "/tools/profit-loss", title: "Profit/loss calculator", crumb: "Profit/loss", area: "tools", parent: "tools", access: "public", layout: "app", activeNav: "tools", indexable: true, query: ["side", "entry", "exit", "size", "fees"], summary: "Compute PnL including fees." },
  { id: "tools-leverage", path: "/tools/leverage", title: "Leverage & liquidation calculator", crumb: "Leverage", area: "tools", parent: "tools", access: "public", layout: "app", activeNav: "tools", indexable: true, query: ["side", "entry", "leverage", "size"], summary: "Estimate margin and liquidation price." },

  // ───────────── 9. Alerts ─────────────
  { id: "alerts", path: "/alerts", title: "Alerts", crumb: "Alerts", area: "alerts", parent: null, access: "authenticated", layout: "app", activeNav: "alerts", indexable: false, related: ["alerts-new", "alerts-triggered", "settings-notifications"], summary: "The user's alert rules with enable/disable." },
  { id: "alerts-new", path: "/alerts/new", title: "New alert", crumb: "New", area: "alerts", parent: "alerts", access: "authenticated", layout: "focus", activeNav: "alerts", indexable: false, query: ["instrument", "signalId", "type"], summary: "Create an alert. Supports prefill from a signal or instrument." },
  { id: "alerts-triggered", path: "/alerts/triggered", title: "Triggered alerts", crumb: "Triggered", area: "alerts", parent: "alerts", access: "authenticated", layout: "app", activeNav: "alerts", indexable: false, related: ["signal-detail"], summary: "Chronological log of fired alerts (notification bell target)." },
  { id: "alert-detail", path: "/alerts/:alertId", title: "Edit alert", crumb: "{alertId}", area: "alerts", parent: "alerts", access: "authenticated", layout: "focus", activeNav: "alerts", indexable: false, summary: "View, edit or delete one alert rule." },

  // ───────────── 10. Academy ─────────────
  { id: "academy", path: "/academy", title: "Academy", crumb: "Academy", area: "academy", parent: null, access: "public", layout: "app", activeNav: "academy", indexable: true, query: ["q", "level"], related: ["academy-glossary", "methodology"], summary: "Learning hub organised by topic and level." },
  { id: "academy-topic", path: "/academy/topics/:topicSlug", title: "Academy topic", crumb: "{topicSlug}", area: "academy", parent: "academy", access: "public", layout: "app", activeNav: "academy", indexable: true, summary: "Ordered list of articles in one topic." },
  { id: "academy-article", path: "/academy/articles/:articleSlug", title: "Academy article", crumb: "{articleSlug}", area: "academy", parent: "academy", access: "public", layout: "reading", activeNav: "academy", indexable: true, related: ["academy-glossary", "tools"], summary: "A single lesson." },
  { id: "academy-glossary", path: "/academy/glossary", title: "Glossary", crumb: "Glossary", area: "academy", parent: "academy", access: "public", layout: "reading", activeNav: "academy", indexable: true, query: ["q"], summary: "Definitions of trading and product terms." },

  // ───────────── 11. Methodology ─────────────
  { id: "methodology", path: "/methodology", title: "Methodology", crumb: "Methodology", area: "methodology", parent: null, access: "public", layout: "reading", activeNav: "methodology", indexable: true, related: ["methodology-scoring", "methodology-data-modes", "methodology-performance", "methodology-strategies"], summary: "How signals are produced, scored and measured." },
  { id: "methodology-scoring", path: "/methodology/scoring", title: "Confidence scoring", crumb: "Scoring", area: "methodology", parent: "methodology", access: "public", layout: "reading", activeNav: "methodology", indexable: true, summary: "How the 0–100 confidence score is built." },
  { id: "methodology-data-modes", path: "/methodology/data-modes", title: "Data modes", crumb: "Data modes", area: "methodology", parent: "methodology", access: "public", layout: "reading", activeNav: "methodology", indexable: true, summary: "Explains DEMO, PAPER and LIVE." },
  { id: "methodology-performance", path: "/methodology/performance-calculation", title: "Performance calculation", crumb: "Performance calculation", area: "methodology", parent: "methodology", access: "public", layout: "reading", activeNav: "methodology", indexable: true, summary: "Definitions of win rate, R-multiple, drawdown; how outcomes are resolved." },
  { id: "methodology-strategies", path: "/methodology/strategies", title: "Strategies", crumb: "Strategies", area: "methodology", parent: "methodology", access: "public", layout: "reading", activeNav: "methodology", indexable: true, summary: "Catalogue of strategies." },
  { id: "methodology-strategy", path: "/methodology/strategies/:strategyKey", title: "Strategy definition", crumb: "{strategyKey}", area: "methodology", parent: "methodology-strategies", access: "public", layout: "reading", activeNav: "methodology", indexable: true, related: ["performance-strategy"], summary: "Logic, parameters, version history of one strategy." },

  // ───────────── 12. Settings ─────────────
  { id: "settings", path: "/settings", title: "Settings", crumb: "Settings", area: "settings", parent: null, access: "authenticated", layout: "app", activeNav: "settings", indexable: false, summary: "Settings index. List on mobile; desktop shows Account in a split view." },
  { id: "settings-account", path: "/settings/account", title: "Account", crumb: "Account", area: "settings", parent: "settings", access: "authenticated", layout: "app", activeNav: "settings", indexable: false, summary: "Profile, email, delete account." },
  { id: "settings-preferences", path: "/settings/preferences", title: "Preferences", crumb: "Preferences", area: "settings", parent: "settings", access: "authenticated", layout: "app", activeNav: "settings", indexable: false, summary: "Theme, timezone, default timeframe, default view mode (from allowed modes)." },
  { id: "settings-notifications", path: "/settings/notifications", title: "Notifications", crumb: "Notifications", area: "settings", parent: "settings", access: "authenticated", layout: "app", activeNav: "settings", indexable: false, summary: "Delivery channels and quiet hours." },
  { id: "settings-security", path: "/settings/security", title: "Security", crumb: "Security", area: "settings", parent: "settings", access: "authenticated", layout: "app", activeNav: "settings", indexable: false, summary: "Password, sessions, two-factor." },

  // ───────────── 13. Risk Disclaimer ─────────────
  { id: "risk-disclaimer", path: "/risk-disclaimer", title: "Risk disclaimer", crumb: "Risk disclaimer", area: "risk-disclaimer", parent: null, access: "public", layout: "reading", activeNav: "risk-disclaimer", indexable: true, related: ["methodology-data-modes", "terms"], summary: "Full risk disclosure. Signals are informational, not financial advice." },
] as const satisfies readonly RouteDef[];

export type RouteId = (typeof ROUTES)[number]["id"];
const ALL: readonly RouteDef[] = ROUTES;
const BY_ID = new Map<string, RouteDef>(ALL.map((r) => [r.id, r]));

export function routeById(id: string): RouteDef {
  const r = BY_ID.get(id);
  if (!r) throw new Error(`Unknown route id: ${id}`);
  return r;
}

const segments = (p: string) => p.split("/").filter(Boolean);
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Resolve a URL pathname to a route. Static segments always beat `:param` segments. Unmatched → `not-found`. */
export function matchRoute(pathname: string): { route: RouteDef; params: Record<string, string> } {
  const parts = segments(pathname.split(/[?#]/)[0] ?? "");
  let best: { route: RouteDef; params: Record<string, string>; score: number } | null = null;
  for (const route of ALL) {
    if (route.path === "*") continue;
    const rs = segments(route.path);
    if (rs.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let score = 0;
    let ok = true;
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i] as string;
      const p = parts[i] as string;
      if (r.startsWith(":")) params[r.slice(1)] = safeDecode(p);
      else if (r === p) score++;
      else {
        ok = false;
        break;
      }
    }
    if (ok && (!best || score > best.score)) best = { route, params, score };
  }
  return best ? { route: best.route, params: best.params } : { route: routeById("not-found"), params: {} };
}

/** Build a URL. Throws if a path param is missing or a query key is not declared by the route. */
export function buildPath(id: RouteId, params: Record<string, string> = {}, query: Record<string, string | undefined> = {}): string {
  const route = routeById(id);
  if (route.path === "*") throw new Error(`Route ${id} has no concrete path`);
  const path =
    "/" +
    segments(route.path)
      .map((s) => {
        if (!s.startsWith(":")) return s;
        const v = params[s.slice(1)];
        if (v === undefined || v === "") throw new Error(`Missing param "${s.slice(1)}" for route ${id}`);
        return encodeURIComponent(v);
      })
      .join("/");
  const allowed: readonly string[] = route.query ?? [];
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (!allowed.includes(k)) throw new Error(`Query "${k}" is not declared for route ${id}`);
    qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

function tryBuildPath(id: RouteId, params: Record<string, string>): string | null {
  try {
    return buildPath(id, params);
  } catch {
    return null;
  }
}

export interface Crumb {
  routeId: string;
  label: string;
  path: string | null;
  current: boolean;
}

/** Breadcrumb trail, root → current. `origin` selects an alternate parent chain (e.g. Signal Detail opened from History). */
export function getBreadcrumbs(
  id: RouteId,
  opts: { params?: Record<string, string>; labels?: Record<string, string>; origin?: string } = {},
): Crumb[] {
  const params = opts.params ?? {};
  const chain: RouteDef[] = [];
  const seen = new Set<string>();
  let cur: RouteDef | null = routeById(id);
  let first = true;
  while (cur) {
    if (seen.has(cur.id)) throw new Error(`Breadcrumb cycle at ${cur.id}`);
    seen.add(cur.id);
    chain.unshift(cur);
    const alt: string | undefined = first && opts.origin ? cur.altParents?.[opts.origin] : undefined;
    const parentId: string | null = alt ?? cur.parent;
    cur = parentId ? routeById(parentId) : null;
    first = false;
  }
  return chain.map((r, i) => {
    const path = tryBuildPath(r.id as RouteId, params);
    const label = opts.labels?.[r.id] ?? r.crumb.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? k);
    return { routeId: r.id, label, path, current: i === chain.length - 1 };
  });
}

export type GuardResult = { allow: true } | { allow: false; redirectTo: string };

/** Access control for a matched route. `fullPath` (with query) is preserved in `returnTo`. */
export function guardRoute(route: RouteDef, isAuthenticated: boolean, fullPath: string): GuardResult {
  if (isAuthenticated && (route.id === "login" || route.id === "signup")) return { allow: false, redirectTo: "/signals" };
  if (route.access === "authenticated" && !isAuthenticated) {
    return { allow: false, redirectTo: `/login?returnTo=${encodeURIComponent(fullPath)}` };
  }
  return { allow: true };
}
