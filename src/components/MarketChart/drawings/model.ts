export type DrawingKind =
  | "trend" | "ray" | "info" | "extended" | "angle" | "hline" | "hray" | "vline" | "cross" | "arrow"
  | "fib" | "fibext" | "fibtime"
  | "channel" | "pitchfork"
  | "rect" | "ellipse" | "triangle" | "brush"
  | "measure" | "pricerange" | "daterange" | "long" | "short"
  | "text" | "label" | "flag" | "arrowup" | "arrowdown";

export type Category = "lines" | "fib" | "channels" | "shapes" | "measure" | "notes";
export type DashStyle = "solid" | "dashed" | "dotted";

/** time = UTC epoch SECONDS (same unit as the chart), price = real price. Timeframe independent. */
export interface Anchor { time: number; price: number }
export interface DrawStyle { color?: string; width?: number; dash?: DashStyle }
export interface Drawing { id: string; kind: DrawingKind; anchors: Anchor[]; text?: string; style?: DrawStyle; locked?: boolean }

/** points = clicks needed. 0 = freehand (press, drag, release). */
export interface ToolDef { kind: DrawingKind; label: string; title: string; points: number; cat: Category }

export const CATEGORIES: ReadonlyArray<{ id: Category; label: string }> = [
  { id: "lines", label: "Lines" }, { id: "fib", label: "Fib" }, { id: "channels", label: "Channels" },
  { id: "shapes", label: "Shapes" }, { id: "measure", label: "Measure" }, { id: "notes", label: "Notes" },
];

export const TOOLS: readonly ToolDef[] = [
  { kind: "trend", label: "Trend", title: "Trend line", points: 2, cat: "lines" },
  { kind: "ray", label: "Ray", title: "Ray", points: 2, cat: "lines" },
  { kind: "info", label: "Info Line", title: "Trend line with price, % and bars", points: 2, cat: "lines" },
  { kind: "extended", label: "Ext Line", title: "Extended line", points: 2, cat: "lines" },
  { kind: "angle", label: "Angle", title: "Trend angle", points: 2, cat: "lines" },
  { kind: "hline", label: "H-Line", title: "Horizontal line", points: 1, cat: "lines" },
  { kind: "hray", label: "H-Ray", title: "Horizontal ray", points: 1, cat: "lines" },
  { kind: "vline", label: "V-Line", title: "Vertical line", points: 1, cat: "lines" },
  { kind: "cross", label: "Cross", title: "Cross line", points: 1, cat: "lines" },
  { kind: "arrow", label: "Arrow", title: "Arrow", points: 2, cat: "lines" },
  { kind: "fib", label: "Fib Retr", title: "Fib retracement", points: 2, cat: "fib" },
  { kind: "fibext", label: "Fib Ext", title: "Trend-based fib extension (A, B, C)", points: 3, cat: "fib" },
  { kind: "fibtime", label: "Fib Time", title: "Fib time zones", points: 2, cat: "fib" },
  { kind: "channel", label: "Channel", title: "Parallel channel (A, B, width)", points: 3, cat: "channels" },
  { kind: "pitchfork", label: "Pitchfork", title: "Andrews pitchfork (A, B, C)", points: 3, cat: "channels" },
  { kind: "rect", label: "Rect", title: "Rectangle", points: 2, cat: "shapes" },
  { kind: "ellipse", label: "Ellipse", title: "Ellipse", points: 2, cat: "shapes" },
  { kind: "triangle", label: "Triangle", title: "Triangle", points: 3, cat: "shapes" },
  { kind: "brush", label: "Brush", title: "Freehand brush (press, drag, release)", points: 0, cat: "shapes" },
  { kind: "measure", label: "Measure", title: "Measure price, % and bars", points: 2, cat: "measure" },
  { kind: "pricerange", label: "Price Range", title: "Price range", points: 2, cat: "measure" },
  { kind: "daterange", label: "Date Range", title: "Date range", points: 2, cat: "measure" },
  { kind: "long", label: "Long", title: "Long position (entry, target)", points: 2, cat: "measure" },
  { kind: "short", label: "Short", title: "Short position (entry, target)", points: 2, cat: "measure" },
  { kind: "text", label: "Text", title: "Text", points: 1, cat: "notes" },
  { kind: "label", label: "Price Label", title: "Price label", points: 1, cat: "notes" },
  { kind: "flag", label: "Flag", title: "Flag", points: 1, cat: "notes" },
  { kind: "arrowup", label: "Arrow Up", title: "Arrow marker up", points: 1, cat: "notes" },
  { kind: "arrowdown", label: "Arrow Dn", title: "Arrow marker down", points: 1, cat: "notes" },
];

export const toolOf = (k: DrawingKind): ToolDef | undefined => TOOLS.find((t) => t.kind === k);
export const newId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * Long/Short are placed with 2 clicks (entry, target); the stop is added automatically at 1:2 risk
 * (anchors become [entry, target, stop]) and can be dragged afterwards.
 */
export function completeAnchors(kind: DrawingKind, a: Anchor[]): Anchor[] {
  const e = a[0], t = a[1];
  if ((kind === "long" || kind === "short") && e && t && a.length === 2) {
    return [e, t, { time: t.time, price: e.price - (t.price - e.price) / 2 }];
  }
  return a;
}

const storageKey = (symbol: string): string => `cg:drawings:${symbol}`;

export function loadDrawings(symbol: string): Drawing[] {
  try {
    const raw = window.localStorage.getItem(storageKey(symbol));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is Drawing => {
      if (typeof d !== "object" || d === null) return false;
      const r = d as Partial<Drawing>;
      const def = r.kind ? toolOf(r.kind) : undefined;
      return !!def && typeof r.id === "string" && Array.isArray(r.anchors) && r.anchors.length >= Math.max(def.points, 2)
        && r.anchors.every((a) => Number.isFinite(a.time) && Number.isFinite(a.price));
    });
  } catch { return []; }
}

export function saveDrawings(symbol: string, list: readonly Drawing[]): void {
  try { window.localStorage.setItem(storageKey(symbol), JSON.stringify(list)); } catch { /* storage blocked: drawings stay in memory */ }
}
