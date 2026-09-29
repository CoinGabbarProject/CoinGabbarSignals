import { routeById, type NavItemId, type RouteId } from "./routes.js";

export type NavGroupId = "trade" | "research" | "manage" | "learn" | "account" | "legal";
export type BadgeKey = "newSignals" | "unreadAlerts";

export interface NavItem {
  readonly id: NavItemId;
  readonly label: string;
  readonly routeId: RouteId;
  /** Semantic icon name only. Visual treatment is defined later in the design phase. */
  readonly iconKey: string;
  readonly requiresAuth: boolean;
  readonly badge?: BadgeKey;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "signals", label: "Signals", routeId: "signals", iconKey: "signal", requiresAuth: false, badge: "newSignals" },
  { id: "history", label: "History", routeId: "history", iconKey: "history", requiresAuth: false },
  { id: "performance", label: "Performance", routeId: "performance", iconKey: "performance", requiresAuth: false },
  { id: "backtesting", label: "Backtesting", routeId: "backtesting", iconKey: "backtest", requiresAuth: true },
  { id: "market", label: "Market", routeId: "market", iconKey: "market", requiresAuth: false },
  { id: "watchlist", label: "Watchlist", routeId: "watchlist", iconKey: "watchlist", requiresAuth: true },
  { id: "tools", label: "Tools", routeId: "tools", iconKey: "tools", requiresAuth: false },
  { id: "alerts", label: "Alerts", routeId: "alerts", iconKey: "alert", requiresAuth: true, badge: "unreadAlerts" },
  { id: "academy", label: "Academy", routeId: "academy", iconKey: "academy", requiresAuth: false },
  { id: "methodology", label: "Methodology", routeId: "methodology", iconKey: "methodology", requiresAuth: false },
  { id: "settings", label: "Settings", routeId: "settings", iconKey: "settings", requiresAuth: true },
  { id: "risk-disclaimer", label: "Risk disclaimer", routeId: "risk-disclaimer", iconKey: "shield", requiresAuth: false },
];

/** Primary header navigation. Kept intentionally separate from secondary/account/legal areas. */
export const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { id: "signals", label: "Active Signals", routeId: "signals", iconKey: "signal", requiresAuth: false, badge: "newSignals" },
  { id: "history", label: "Signal History", routeId: "history", iconKey: "history", requiresAuth: false },
  { id: "performance", label: "Performance", routeId: "performance", iconKey: "performance", requiresAuth: false },
  { id: "watchlist", label: "Watchlist", routeId: "watchlist", iconKey: "watchlist", requiresAuth: true },
  { id: "market", label: "Market Analysis", routeId: "market", iconKey: "market", requiresAuth: false },
  { id: "tools", label: "Tools", routeId: "tools", iconKey: "tools", requiresAuth: false },
  { id: "alerts", label: "Alerts", routeId: "alerts", iconKey: "alert", requiresAuth: true, badge: "unreadAlerts" },
  { id: "settings", label: "Settings", routeId: "settings", iconKey: "settings", requiresAuth: true },
];

/** Horizontal trader navigation: the former left-sidebar menu, with Market Overview and Quick Links removed. */
export const DESKTOP_NAV: readonly NavGroup[] = [
  { id: "trade", label: "Trader", items: ["signals", "history", "performance", "watchlist", "market", "tools", "alerts", "settings"] },
];

export interface NavGroup {
  readonly id: NavGroupId;
  readonly label: string;
  readonly items: readonly NavItemId[];
}


export type MobileTab = { readonly kind: "item"; readonly item: NavItemId } | { readonly kind: "more" };

/** Mobile bottom tab bar, left to right. Exactly five slots. */
export const MOBILE_TABS: readonly MobileTab[] = [
  { kind: "item", item: "signals" },
  { kind: "item", item: "market" },
  { kind: "item", item: "watchlist" },
  { kind: "item", item: "alerts" },
  { kind: "more" },
];

/** Contents of the "More" sheet. Together with MOBILE_TABS this must cover every nav item. */
export const MOBILE_MORE: readonly NavGroup[] = [
  { id: "trade", label: "Trade", items: ["history", "performance", "backtesting"] },
  { id: "research", label: "Research", items: ["tools"] },
  { id: "learn", label: "Learn", items: ["academy", "methodology"] },
  { id: "account", label: "Account", items: ["settings"] },
  { id: "legal", label: "Legal", items: ["risk-disclaimer"] },
];

export interface NavContext {
  isAuthenticated: boolean;
  currentRouteId: string;
  badges?: Partial<Record<BadgeKey, number>>;
}
export interface NavItemState {
  /** Current page belongs to this item's area (including descendants and Signal Detail → Signals). */
  selected: boolean;
  /** Requires login and the visitor is anonymous. Still navigable: routes to login with returnTo. */
  locked: boolean;
  badgeCount: number;
}

export function resolveNavItemState(item: NavItem, ctx: NavContext): NavItemState {
  return {
    selected: routeById(ctx.currentRouteId).activeNav === item.id,
    locked: item.requiresAuth && !ctx.isAuthenticated,
    badgeCount: item.badge ? (ctx.badges?.[item.badge] ?? 0) : 0,
  };
}

/** The "More" tab is selected when the current area lives inside the More sheet. */
export function isMoreTabSelected(currentRouteId: string): boolean {
  const active = routeById(currentRouteId).activeNav;
  return active !== null && MOBILE_MORE.some((g) => g.items.includes(active));
}
