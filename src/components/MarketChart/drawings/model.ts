export type DrawingKind =
  | "trend" | "ray" | "extended" | "hline" | "vline"
  | "fib" | "fibext" | "channel" | "rect" | "measure" | "position" | "text";

/** time = UTC epoch SECONDS (same unit as the chart), price = real price. Timeframe independent. */
export interface Anchor { time: number; price: number }

export interface Drawing { id: string; kind: DrawingKind; anchors: Anchor[]; text?: string }

export interface ToolDef { kind: DrawingKind; label: string; title: string; points: number }

export const TOOLS: readonly ToolDef[] = [
  { kind: "trend", label: "Trend", title: "Trend line", points: 2 },
  { kind: "ray", label: "Ray", title: "Ray (extends right)", points: 2 },
  { kind: "extended", label: "Ext Line", title: "Extended line (both sides)", points: 2 },
  { kind: "hline", label: "H-Line", title: "Horizontal line (support / resistance)", points: 1 },
  { kind: "vline", label: "V-Line", title: "Vertical line", points: 1 },
  { kind: "fib", label: "Fib", title: "Fib retracement", points: 2 },
  { kind: "fibext", label: "Fib Ext", title: "Trend-based fib extension (A, B, C)", points: 3 },
  { kind: "channel", label: "Channel", title: "Parallel channel (A, B, then width)", points: 3 },
  { kind: "rect", label: "Rect", title: "Rectangle / zone", points: 2 },
  { kind: "measure", label: "Measure", title: "Measure price, % and bars", points: 2 },
  { kind: "position", label: "R:R", title: "Long/Short position: entry, stop, target", points: 3 },
  { kind: "text", label: "Text", title: "Text label", points: 1 },
];

export const toolOf = (k: DrawingKind): ToolDef | undefined => TOOLS.find((t) => t.kind === k);

export const newId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

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
      return !!def && typeof r.id === "string" && Array.isArray(r.anchors) && r.anchors.length === def.points
        && r.anchors.every((a) => Number.isFinite(a.time) && Number.isFinite(a.price));
    });
  } catch { return []; }
}

export function saveDrawings(symbol: string, list: readonly Drawing[]): void {
  try { window.localStorage.setItem(storageKey(symbol), JSON.stringify(list)); } catch { /* storage blocked: drawings stay in memory */ }
}
