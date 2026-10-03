import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from "react";
import type { Timeframe } from "../../../../shared/market.js";
import { tokens } from "../../../../shared/designTokens.js";
import { PERIOD_MS } from "../../../market/useLiveCandles.js";
import type { MarketChartApi } from "../types.js";
import { DrawingsPrimitive } from "./DrawingsPrimitive.js";
import { completeAnchors, loadDrawings, newId, saveDrawings, toolOf } from "./model.js";
import type { Anchor, DashStyle, DrawStyle, Drawing, DrawingKind } from "./model.js";

const c = tokens.color;
type Tool = DrawingKind | "cursor";
type Hover = "none" | "move" | "locked";

const HISTORY_LIMIT = 100;
const BRUSH_MAX_POINTS = 1500;
const SWATCHES: readonly string[] = [c.accent.primary, c.accent.secondary, c.positive.base, c.negative.base, c.warning.base, c.mode.paper, c.neutral.base, c.text.primary];
const WIDTHS: readonly number[] = [1, 2, 3, 4];
const DASHES: ReadonlyArray<{ id: DashStyle; label: string }> = [{ id: "solid", label: "Solid" }, { id: "dashed", label: "Dash" }, { id: "dotted", label: "Dot" }];
/** Kinds whose drawing honours style.color / style.width+dash (the rest use fixed semantic colors). */
const COLORABLE: ReadonlySet<DrawingKind> = new Set<DrawingKind>(["trend", "ray", "info", "extended", "angle", "hline", "hray", "vline", "cross", "arrow", "channel", "pitchfork", "rect", "ellipse", "triangle", "brush", "text", "label", "flag"]);
const STROKED: ReadonlySet<DrawingKind> = new Set<DrawingKind>(["trend", "ray", "info", "extended", "angle", "hline", "hray", "vline", "cross", "arrow", "channel", "pitchfork", "ellipse", "triangle", "brush"]);

const btn = (active: boolean, disabled = false): CSSProperties => ({
  minHeight: 32, padding: "0 10px", borderRadius: 4, cursor: disabled ? "default" : "pointer", font: "inherit", fontSize: 12, flex: "0 0 auto",
  color: disabled ? c.text.disabled : active ? c.text.inverse : c.text.primary,
  background: active ? c.accent.primary : c.bg.elevated,
  border: `1px solid ${active ? c.accent.primary : c.border.default}`,
});
const swatch = (color: string, active: boolean): CSSProperties => ({
  width: 24, height: 24, borderRadius: "50%", cursor: "pointer", flex: "0 0 auto", padding: 0, background: color,
  border: `2px solid ${active ? c.text.primary : c.border.default}`,
});
const barStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", overflowX: "auto", scrollbarWidth: "none" };
const sep: CSSProperties = { width: 1, alignSelf: "stretch", background: c.border.default, flex: "0 0 auto" };
const hint: CSSProperties = { fontSize: 12, color: c.text.muted, whiteSpace: "nowrap", flex: "0 0 auto" };

// ---- Drawings menu (bottom sheet) -----------------------------------------
type GroupId = "lines" | "fib" | "shapes" | "forecast" | "notes";
type SheetTab = "favorites" | "tools" | "indicators" | GroupId;
/** Sheet groups. Every drawing kind appears in exactly one group, in the order shown. */
const SHEET_GROUPS: ReadonlyArray<{ id: GroupId; label: string; kinds: readonly DrawingKind[] }> = [
  { id: "lines", label: "Trend lines", kinds: ["trend", "ray", "info", "extended", "angle", "hline", "hray", "vline", "cross", "arrow", "channel", "pitchfork"] },
  { id: "fib", label: "Gann and Fibonacci", kinds: ["fib", "fibext", "fibtime"] },
  { id: "shapes", label: "Shapes", kinds: ["rect", "ellipse", "triangle", "brush"] },
  { id: "forecast", label: "Forecasting and measurement", kinds: ["long", "short", "measure", "pricerange", "daterange"] },
  { id: "notes", label: "Annotation", kinds: ["text", "label", "flag", "arrowup", "arrowdown"] },
];
const SHEET_TABS: ReadonlyArray<{ id: SheetTab; label: string }> = [{ id: "favorites", label: "Favorites" }, { id: "tools", label: "Tools" }, { id: "indicators", label: "Indicators" }, ...SHEET_GROUPS.map((g) => ({ id: g.id, label: g.label }))];

const TILE_LABEL: Record<DrawingKind, string> = {
  trend: "Trend Line", ray: "Ray", info: "Info Line", extended: "Extended Line", angle: "Trend Angle", hline: "Horizontal Line", hray: "Horizontal Ray",
  vline: "Vertical Line", cross: "Cross Line", arrow: "Arrow", channel: "Parallel Channel", pitchfork: "Pitchfork",
  fib: "Fib Retracement", fibext: "Trend-Based Fib", fibtime: "Fib Time Zone",
  rect: "Rectangle", ellipse: "Ellipse", triangle: "Triangle", brush: "Brush",
  long: "Long Position", short: "Short Position", measure: "Measure", pricerange: "Price Range", daterange: "Date Range",
  text: "Text", label: "Price Label", flag: "Flag", arrowup: "Arrow Up", arrowdown: "Arrow Down",
};

const menuBtn = (open: boolean): CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6, minHeight: 30, padding: "0 12px 0 9px", borderRadius: 999, cursor: "pointer",
  font: "inherit", fontSize: 12, fontWeight: 600, flex: "0 0 auto", color: c.text.primary,
  background: open ? c.accent.primarySubtle : c.bg.elevated, border: `1px solid ${open ? c.state.selectedEdge : c.border.default}`,
});
const tabBtn = (active: boolean): CSSProperties => ({
  flex: "0 0 auto", minHeight: 32, padding: "0 14px", borderRadius: 10, border: 0, cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 600,
  whiteSpace: "nowrap", color: active ? c.text.primary : c.text.muted, background: active ? c.state.selected : "transparent",
});
const tileStyle = (active: boolean, disabled: boolean): CSSProperties => ({
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 72, padding: "10px 6px",
  borderRadius: 12, cursor: disabled ? "default" : "pointer", font: "inherit", fontSize: 12, textAlign: "center", minWidth: 0,
  color: disabled ? c.text.disabled : active ? c.accent.primary : c.text.primary,
  background: active ? c.accent.primarySubtle : c.bg.panel, border: `1px solid ${active ? c.state.selectedEdge : c.border.subtle}`,
});

/** 24px stroke icon from a single SVG path (currentColor, so it follows the tile state). */
function Ico({ d }: { d: string }): ReactElement {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const ICON = {
  pencil: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
  cursor: "M5 3l14 7-6 2-2 6z",
  magnet: "M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3z",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  eyeOff: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM3 3l18 18",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 11a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  close: "M6 6l12 12M18 6L6 18",
} as const;

/** Small circle (anchor point) as SVG path data. */
const dot = (x: number, y: number): string => `M${x - 2} ${y}a2 2 0 1 0 4 0a2 2 0 1 0 -4 0`;
const TOOL_ICON: Record<DrawingKind, string> = {
  trend: `M7.5 16.5L16.5 7.5${dot(5, 19)}${dot(19, 5)}`,
  ray: `M7.5 16.5L21 3${dot(5, 19)}`,
  info: `M7.5 16.5L14.5 9.5${dot(5, 19)}${dot(16, 8)}M15 14h6v6h-6z`,
  extended: `M9.5 14.5L14.5 9.5M3 21l2-2M19 5l2-2${dot(8, 16)}${dot(16, 8)}`,
  angle: `M6 19h14M7 17.5L17 8${dot(5, 19)}${dot(18, 7)}M11 19a6 6 0 0 0-1-3`,
  hline: `M3 12h7M14 12h7${dot(12, 12)}`,
  hray: `M7 12h14${dot(5, 12)}`,
  vline: `M12 3v7M12 14v7${dot(12, 12)}`,
  cross: `M3 12h7M14 12h7M12 3v7M12 14v7${dot(12, 12)}`,
  arrow: "M5 19L18 6M10 6h8v8",
  channel: "M5 15L15 5M9 19L19 9",
  pitchfork: `M5 19L20 4M9 21L21 9M3 15L15 3${dot(4, 20)}`,
  fib: `M8 5h13M8 9.7h13M8 14.3h13M8 19h13${dot(5, 5)}${dot(5, 19)}`,
  fibext: `M10 7h11M10 12h11M10 17h11M10 21h11M6.5 10.5L10 7${dot(5, 12)}${dot(8, 5)}`,
  fibtime: `M9 4v16M13 4v16M17 4v16M21 4v16${dot(5, 8)}`,
  rect: "M5 5h14v14H5z",
  ellipse: "M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z",
  triangle: "M12 5L20 19H4z",
  brush: "M4 16c3-8 5 4 8-2s4-6 8-4",
  long: "M4 12h16M4 5h16v7M4 18h16",
  short: "M4 12h16M4 19h16v-7M4 6h16",
  measure: "M4 16l12-12 4 4L8 20zM8 12l2 2M11 9l2 2M14 6l2 2",
  pricerange: "M5 5h14M5 19h14M12 8v8M9.5 10.5L12 8l2.5 2.5M9.5 13.5L12 16l2.5-2.5",
  daterange: "M5 5v14M19 5v14M8 12h8M13.5 9.5L16 12l-2.5 2.5",
  text: "M6 6h12M12 6v13M9 19h6",
  label: "M3 12l5-5h13v10H8z",
  flag: "M6 21V4M6 5h12l-3 4 3 4H6",
  arrowup: "M12 20V6M6 12l6-6 6 6",
  arrowdown: "M12 4v14M6 12l6 6 6-6",
};

// ---- Favorites (saved in this browser) -------------------------------------
const FAV_KEY = "cg:drawing-favorites";
const FAVBAR_KEY = "cg:drawing-favorites-bar";
const DEFAULT_FAVS: readonly DrawingKind[] = ["trend", "hray", "hline", "channel", "fib", "fibext", "pricerange", "long", "short", "rect", "text", "label"];
function loadFavs(): DrawingKind[] {
  try {
    const raw = window.localStorage.getItem(FAV_KEY);
    if (raw === null) return [...DEFAULT_FAVS];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_FAVS];
    return parsed.filter((k): k is DrawingKind => typeof k === "string" && toolOf(k as DrawingKind) !== undefined);
  } catch { return [...DEFAULT_FAVS]; }
}
function saveFavs(list: readonly DrawingKind[]): void {
  try { window.localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch { /* storage blocked: favorites last until reload */ }
}
function loadFavBar(): boolean {
  try { return window.localStorage.getItem(FAVBAR_KEY) === "1"; } catch { return false; }
}
function saveFavBar(on: boolean): void {
  try { window.localStorage.setItem(FAVBAR_KEY, on ? "1" : "0"); } catch { /* storage blocked */ }
}

/** Indicators with their own pane under the price chart; the rest are drawn on the price chart. */
const PANE_INDICATORS: ReadonlySet<string> = new Set(["rsi", "macd"]);
const EMA_ICON = "M3 16c3-8 5 2 9-4s6-4 9-6";
const INDICATOR_ICON: Record<string, string> = {
  ema20: EMA_ICON,
  ema50: "M3 17c3-7 6 1 9-3s6-5 9-7",
  sma200: "M3 15c4-2 6 1 9-1s6-3 9-5",
  bb: "M3 7c4-3 6 2 9 0s6-3 9 0M3 17c4-3 6 2 9 0s6-3 9 0M3 12c4-3 6 2 9 0s6-3 9 0",
  vwap: "M3 17l5-4 4 2 4-6 5-2",
  rsi: "M3 7h18M3 17h18M5 14l4-4 3 3 4-5 3 3",
  macd: "M5 15v4M9 12v7M13 9v10M17 13v6M3 8c5 3 9-3 18 2",
};
const indicatorIcon = (key: string): string => INDICATOR_ICON[key] ?? EMA_ICON;
const sectionLabel: CSSProperties = { gridColumn: "1 / -1", fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: c.text.muted, margin: "4px 2px 0" };

interface TileProps {
  label: string; title?: string; icon?: ReactNode; active?: boolean; disabled?: boolean;
  /** When set, a ☆ / ★ button is shown in the tile corner. */
  star?: { on: boolean; onToggle(): void };
  onClick(): void;
}
function Tile({ label, title, icon, active, disabled = false, star, onClick }: TileProps): ReactElement {
  const body = (
    <button type="button" title={title ?? label} aria-pressed={active} disabled={disabled} style={{ ...tileStyle(active === true, disabled), flex: 1 }} onClick={onClick}>
      {icon}
      <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
  if (!star) return body;
  return (
    <div style={{ position: "relative", minWidth: 0, display: "flex", flexDirection: "column" }}>
      {body}
      <button type="button" aria-pressed={star.on} aria-label={`${star.on ? "Remove" : "Add"} ${label} ${star.on ? "from" : "to"} favorites`}
        title={star.on ? "Remove from favorites" : "Add to favorites"} onClick={star.onToggle}
        style={{ position: "absolute", top: 2, right: 2, width: 30, height: 30, border: 0, background: "transparent", cursor: "pointer", fontSize: 16, lineHeight: 1, color: star.on ? c.warning.base : c.text.muted }}>
        {star.on ? "★" : "☆"}
      </button>
    </div>
  );
}

interface DragState { id: string; handle: number; start: { x: number; y: number }; orig: Drawing[]; moved: boolean }

/** Indicator list owned by the parent; the Drawings sheet only shows it and reports toggles. */
export interface IndicatorMenu {
  items: ReadonlyArray<{ key: string; label: string; active: boolean }>;
  onToggle(key: string): void;
}

export interface ChartDrawingToolsProps {
  api: MarketChartApi | null;
  symbol: string;
  timeframe: Timeframe;
/** Optional: adds an Indicators tab to the Drawings sheet. */
  indicators?: IndicatorMenu;
  /** The chart itself; the drawing overlay is stacked on top of it. */
  children: ReactNode;
}

/**
 * Drawing toolbar + interaction layer. Drawings are saved per symbol in localStorage.
 * Cursor mode: click selects, drag a handle edits one anchor, drag a body moves the whole drawing.
 */
export function ChartDrawingTools({ api, symbol, timeframe, indicators, children }: ChartDrawingToolsProps): ReactElement {
  const primRef = useRef<DrawingsPrimitive | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const placedRef = useRef<Anchor[]>([]);
  const brushRef = useRef<Anchor[] | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pastRef = useRef<Drawing[][]>([]);
  const futureRef = useRef<Drawing[][]>([]);
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  const [tool, setTool] = useState<Tool>("cursor");
  const [tab, setTab] = useState<SheetTab>("favorites");
  const [favs, setFavs] = useState<DrawingKind[]>(loadFavs);
  const [showFavBar, setShowFavBar] = useState<boolean>(loadFavBar);
  const [menuOpen, setMenuOpen] = useState(false);
  const [magnet, setMagnet] = useState(true);
  const [visible, setVisible] = useState(true);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placedCount, setPlacedCount] = useState(0);
  const [hover, setHover] = useState<Hover>("none");
  const [dragging, setDragging] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const drawingsRef = useRef<Drawing[]>(drawings);
  drawingsRef.current = drawings;

  const selected = drawings.find((d) => d.id === selectedId);
  const def = tool === "cursor" ? undefined : toolOf(tool);

  // attach the primitive to the candle series (once per chart)
  useEffect(() => {
    if (!api) return;
    const prim = new DrawingsPrimitive();
    api.candleSeries.attachPrimitive(prim);
    primRef.current = prim;
    return () => {
      primRef.current = null;
      try { api.candleSeries.detachPrimitive(prim); } catch { /* chart already removed */ }
    };
  }, [api]);

  const syncHistory = useCallback((): void => {
    setCanUndo(pastRef.current.length > 0); setCanRedo(futureRef.current.length > 0);
  }, []);

  useEffect(() => {
    const list = loadDrawings(symbol);
    drawingsRef.current = list; pastRef.current = []; futureRef.current = [];
    setDrawings(list); setSelectedId(null); setTool("cursor"); setVisible(true);
    placedRef.current = []; brushRef.current = null; dragRef.current = null; setPlacedCount(0); syncHistory();
  }, [symbol, syncHistory]);

  useEffect(() => { primRef.current?.setState(drawings, selectedId, visible); }, [api, drawings, selectedId, visible]);
  useEffect(() => { primRef.current?.setPeriod(PERIOD_MS[timeframe] / 1000); }, [api, timeframe]);
  useEffect(() => { setHover("none"); }, [tool]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // page does not scroll behind the sheet
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, [menuOpen]);

  // ---- history ----------------------------------------------------------
  /** Persist a new list and record `before` (default: the current list) as an undo step. */
  const commit = useCallback((next: Drawing[], before?: Drawing[]): void => {
    pastRef.current = [...pastRef.current.slice(-(HISTORY_LIMIT - 1)), before ?? drawingsRef.current];
    futureRef.current = [];
    drawingsRef.current = next;
    setDrawings(next); saveDrawings(symbolRef.current, next); syncHistory();
  }, [syncHistory]);

  const applySnapshot = useCallback((list: Drawing[]): void => {
    drawingsRef.current = list;
    setDrawings(list); saveDrawings(symbolRef.current, list); syncHistory();
    setSelectedId((s) => (s !== null && list.some((d) => d.id === s) ? s : null));
  }, [syncHistory]);

  const undo = useCallback((): void => {
    const prev = pastRef.current.at(-1);
    if (!prev) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, drawingsRef.current];
    applySnapshot(prev);
  }, [applySnapshot]);

  const redo = useCallback((): void => {
    const next = futureRef.current.at(-1);
    if (!next) return;
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [...pastRef.current, drawingsRef.current];
    applySnapshot(next);
  }, [applySnapshot]);

  // ---- editing helpers --------------------------------------------------
  const cancelDraft = useCallback((): void => {
    placedRef.current = []; brushRef.current = null; setPlacedCount(0); primRef.current?.setDraft(null);
  }, []);

  const pickTool = (t: DrawingKind): void => {
    cancelDraft(); setSelectedId(null); setVisible(true);
    setTool(t === tool ? "cursor" : t);
    
  };

  const edit = (fn: (d: Drawing) => Drawing): void => {
    if (!selected) return;
    commit(drawings.map((d) => (d.id === selected.id ? fn(d) : d)));
  };
  const setStyle = (patch: Partial<DrawStyle>): void => edit((d) => ({ ...d, style: { ...d.style, ...patch } }));

  const removeSelected = useCallback((): void => {
    const d = drawingsRef.current.find((x) => x.id === selectedId);
    if (!d || d.locked) return;
    commit(drawingsRef.current.filter((x) => x.id !== d.id)); setSelectedId(null);
  }, [commit, selectedId]);

  const cloneSelected = (): void => {
    if (!selected) return;
    const shift = (PERIOD_MS[timeframe] / 1000) * 5;
    const copy: Drawing = { ...selected, id: newId(), locked: false, anchors: selected.anchors.map((a) => ({ time: a.time + shift, price: a.price })) };
    commit([...drawings, copy]); setSelectedId(copy.id);
  };

  const editText = (): void => {
    if (!selected) return;
    const t = window.prompt("Text", selected.text ?? "");
    if (t !== null) edit((d) => ({ ...d, text: t.trim() }));
  };

  const clearAll = (): void => {
    if (drawings.length > 0 && window.confirm(`Delete all ${drawings.length} drawings on ${symbol}?`)) { commit([]); setSelectedId(null); }
  };

  const shot = (): void => {
    if (!api) return;
    api.chart.takeScreenshot().toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${symbol}-${timeframe}.png`.replace(/[^\w.-]+/g, "_");
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  };

  // select drawings by clicking them (cursor mode)
  useEffect(() => {
    if (!api || tool !== "cursor") return;
    const onClick = (p: { point?: { x: number; y: number } }): void => {
      if (p.point) setSelectedId(primRef.current?.drawingAt(p.point.x, p.point.y) ?? null);
    };
    api.chart.subscribeClick(onClick);
    return () => { try { api.chart.unsubscribeClick(onClick); } catch { /* chart already removed */ } };
  }, [api, tool]);

  // ---- keyboard -----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (mod && key === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && key === "y") { e.preventDefault(); redo(); }
      else if (e.key === "Escape") { cancelDraft(); setTool("cursor"); setSelectedId(null); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) removeSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelDraft, redo, removeSelected, selectedId, undo]);

  // ---- pointer helpers ------------------------------------------------------
  const xyOf = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const el = wrapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const inPane = (x: number): boolean => !!api && x <= api.chart.timeScale().width(); // excludes the price axis

  const anchorFromEvent = (e: { clientX: number; clientY: number }, snap: boolean): Anchor | null => {
    const p = xyOf(e);
    if (!p || !inPane(p.x)) return null;
    return primRef.current?.anchorAt(p.x, p.y, snap) ?? null;
  };

  // ---- drawing mode (place by click, brush by drag) -------------------------
  const draftFrom = (cursor: Anchor): Drawing | null => {
    if (!def || tool === "cursor") return null;
    const anchors = [...placedRef.current, cursor];
    while (anchors.length < def.points) anchors.push(cursor);
    return { id: "draft", kind: tool, anchors: completeAnchors(tool, anchors) };
  };

  const finish = (kind: DrawingKind, anchors: Anchor[], text?: string): void => {
    const d: Drawing = text ? { id: newId(), kind, anchors, text } : { id: newId(), kind, anchors };
    commit([...drawingsRef.current, d]);
    cancelDraft(); setTool("cursor"); setSelectedId(d.id);
  };

  const onDrawDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!def || tool === "cursor") return;
    if (def.points === 0) { // freehand: press, drag, release
      const a = anchorFromEvent(e, false);
      if (!a) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      brushRef.current = [a];
      primRef.current?.setDraft({ id: "draft", kind: tool, anchors: [a, a] });
      return;
    }
    const a = anchorFromEvent(e, magnet);
    if (!a) return;
    const placed = [...placedRef.current, a];
    if (placed.length < def.points) {
      placedRef.current = placed; setPlacedCount(placed.length);
      primRef.current?.setDraft(draftFrom(a));
      return;
    }
    let text: string | undefined;
    if (tool === "text") {
      const t = window.prompt("Text label", "");
      if (t === null || t.trim() === "") { cancelDraft(); return; }
      text = t.trim();
    }
    finish(tool, completeAnchors(tool, placed), text);
  };

  const onDrawMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const brush = brushRef.current, prim = primRef.current;
    if (brush && prim && tool !== "cursor") {
      const a = anchorFromEvent(e, false), p = xyOf(e), last = brush[brush.length - 1];
      const lp = last ? prim.anchorToPixel(last) : null;
      if (!a || !p || !lp || Math.hypot(p.x - lp.x, p.y - lp.y) < 3 || brush.length >= BRUSH_MAX_POINTS) return;
      brush.push(a);
      prim.setDraft({ id: "draft", kind: tool, anchors: [...brush] });
      return;
    }
    if (placedRef.current.length === 0) return;
    const a = anchorFromEvent(e, magnet);
    if (a) prim?.setDraft(draftFrom(a));
  };

  const onDrawUp = (): void => {
    const brush = brushRef.current;
    if (!brush) return;
    if (tool !== "cursor" && brush.length >= 2) finish(tool, brush); else cancelDraft();
  };

  // ---- cursor mode (hover, drag handle, drag body) --------------------------
  const hitAt = (x: number, y: number): { id: string; handle: number } | null => {
    const prim = primRef.current;
    if (!prim || !visible) return null;
    if (selected) {
      const h = prim.anchorHit(selected, x, y);
      if (h >= 0) return { id: selected.id, handle: h };
    }
    const id = prim.drawingAt(x, y);
    return id ? { id, handle: -1 } : null;
  };

  const dragMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const dr = dragRef.current, prim = primRef.current, p = xyOf(e);
    if (!dr || !prim || !p) return;
    const orig = dr.orig.find((d) => d.id === dr.id);
    if (!orig) return;
    let anchors: Anchor[] | null = null;
    if (dr.handle >= 0) {
      const a = prim.anchorAt(p.x, p.y, magnet);
      if (a) anchors = orig.anchors.map((x, i) => (i === dr.handle ? a : x));
    } else {
      const dx = p.x - dr.start.x, dy = p.y - dr.start.y;
      const moved = orig.anchors.map((a) => { const px = prim.anchorToPixel(a); return px ? prim.anchorAt(px.x + dx, px.y + dy, false) : null; });
      if (moved.every((a): a is Anchor => a !== null)) anchors = moved;
    }
    if (!anchors) return;
    dr.moved = true;
    const live = dr.orig.map((d) => (d.id === dr.id ? { ...d, anchors } : d));
    drawingsRef.current = live; setDrawings(live);
  };

  const onWrapMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (tool !== "cursor") return;
    if (dragRef.current) { dragMove(e); return; }
    if (e.pointerType === "touch") return;
    const p = xyOf(e);
    const h = p && inPane(p.x) ? hitAt(p.x, p.y) : null;
    setHover(!h ? "none" : drawings.find((d) => d.id === h.id)?.locked ? "locked" : "move");
  };

  const onGrab = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const p = xyOf(e);
    const h = p ? hitAt(p.x, p.y) : null;
    const d = h ? drawings.find((x) => x.id === h.id) : undefined;
    if (!p || !h || !d) return;
    setSelectedId(d.id);
    if (d.locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: d.id, handle: h.handle, start: p, orig: drawings, moved: false };
    setDragging(true);
  };

  const endDrag = (): void => {
    const dr = dragRef.current;
    if (!dr) return;
    dragRef.current = null; setDragging(false);
    if (dr.moved) commit(drawingsRef.current, dr.orig);
  };

  const status = def ? (def.points === 0 ? `${def.title}` : `${def.title}: point ${Math.min(placedCount + 1, def.points)}/${def.points}`) : null;
  const toggleFav = (k: DrawingKind): void => {
    const next = favs.includes(k) ? favs.filter((x) => x !== k) : [...favs, k];
    setFavs(next); saveFavs(next);
  };
  const toggleFavBar = (): void => { setShowFavBar(!showFavBar); saveFavBar(!showFavBar); };
  const activeLabels = indicators ? indicators.items.filter((i) => i.active).map((i) => i.label).join(" · ") : "";
  const catTools = (SHEET_GROUPS.find((g) => g.id === tab)?.kinds ?? []).flatMap((k) => { const d = toolOf(k); return d ? [d] : []; });
  const showOverlay = tool === "cursor" && (hover !== "none" || dragging);

  return (
    <div style={{ minWidth: 0 }}>
      <div role="toolbar" aria-label="Drawing tools" style={barStyle}>
        <button type="button" aria-haspopup="dialog" aria-expanded={menuOpen} style={menuBtn(menuOpen)} title="Drawing tools and chart actions" onClick={() => setMenuOpen(true)}>
          <Ico d={ICON.pencil} />
          <span>Drawings</span>
        </button>
        {status ? <span role="status" style={hint}>{status}</span> : activeLabels !== "" && <span style={hint} title="Active indicators">{activeLabels}</span>}
        {tool !== "cursor" && (
          <button type="button" style={btn(false)} title="Cancel drawing (Esc)" onClick={() => { cancelDraft(); setTool("cursor"); }}>✕ Cancel</button>
        )}
      </div>
      {showFavBar && favs.length > 0 && (
        <div role="toolbar" aria-label="Favorite drawing tools" style={{ ...barStyle, paddingTop: 0 }}>
          {favs.map((k) => (
            <button key={k} type="button" aria-label={TILE_LABEL[k]} aria-pressed={tool === k} title={TILE_LABEL[k]}
              style={{ ...btn(tool === k), minHeight: 36, width: 40, padding: 0, display: "grid", placeItems: "center" }} onClick={() => pickTool(k)}>
              <Ico d={TOOL_ICON[k]} />
            </button>
          ))}
        </div>
      )}
      {menuOpen && createPortal(
        <div role="presentation" onClick={() => setMenuOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: c.bg.overlay, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div role="dialog" aria-modal="true" aria-label="Drawings" data-cg-sheet="" onClick={(e) => e.stopPropagation()}
            style={{ width: "min(560px, 100%)", maxHeight: "84vh", animation: "cgSheetUp 0.18s ease-out", display: "flex", flexDirection: "column", color: c.text.primary, background: c.bg.elevated,
              borderRadius: "18px 18px 0 0", border: `1px solid ${c.border.default}`, borderBottom: 0, boxShadow: "0 -12px 40px rgba(0, 0, 0, 0.45)" }}>
            <style>{"@keyframes cgSheetUp{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}@media (prefers-reduced-motion:reduce){[data-cg-sheet]{animation:none!important}}"}</style>
            <div aria-hidden="true" style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, background: c.border.strong, margin: "8px 0 2px" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 16px 8px" }}>
              <strong style={{ fontSize: 20 }}>Drawings</strong>
              <button type="button" aria-label="Close" style={{ ...btn(false), minHeight: 32, width: 32, padding: 0, display: "grid", placeItems: "center", borderRadius: 999 }} onClick={() => setMenuOpen(false)}>
                <Ico d={ICON.close} />
              </button>
            </div>
            <div role="tablist" aria-label="Drawing groups" style={{ ...barStyle, padding: "0 12px 8px", borderBottom: `1px solid ${c.border.subtle}` }}>
              {SHEET_TABS.filter((t) => t.id !== "indicators" || indicators !== undefined).map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} style={tabBtn(tab === t.id)} onClick={() => setTab(t.id)}>{t.label}</button>
              ))}
            </div>
            <div role="tabpanel" style={{ overflowY: "auto", padding: "12px 12px calc(12px + env(safe-area-inset-bottom, 0px))", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
              {tab === "favorites" ? (
                <>
                  {favs.length === 0 && (
                    <div style={{ gridColumn: "1 / -1", color: c.text.muted, fontSize: 13, padding: "12px 4px" }}>No favorites yet. Open any group and tap ☆ on a tool to add it here.</div>
                  )}
                  {SHEET_GROUPS.map((g) => {
                    const list = g.kinds.filter((k) => favs.includes(k));
                    if (list.length === 0) return null;
                    return (
                      <div key={g.id} style={{ display: "contents" }}>
                        <div style={sectionLabel}>{g.label.toUpperCase()}</div>
                        {list.map((k) => (
                          <Tile key={k} label={TILE_LABEL[k]} title={toolOf(k)?.title} icon={<Ico d={TOOL_ICON[k]} />} active={tool === k}
                            star={{ on: true, onToggle: () => toggleFav(k) }} onClick={() => { pickTool(k); setMenuOpen(false); }} />
                        ))}
                      </div>
                    );
                  })}
                </>
              ) : tab === "tools" ? (
                <>
                  <Tile label="Cursor" title="Cursor / select" icon={<Ico d={ICON.cursor} />} active={tool === "cursor"} onClick={() => { cancelDraft(); setTool("cursor"); setMenuOpen(false); }} />
                  <Tile label="Magnet" title="Snap to candle open/high/low/close" icon={<Ico d={ICON.magnet} />} active={magnet} onClick={() => setMagnet((m) => !m)} />
                  <Tile label="Undo" title="Undo (Ctrl+Z)" icon={<Ico d={ICON.undo} />} disabled={!canUndo} onClick={undo} />
                  <Tile label="Redo" title="Redo (Ctrl+Shift+Z)" icon={<Ico d={ICON.redo} />} disabled={!canRedo} onClick={redo} />
                  <Tile label={visible ? "Hide all" : "Show all"} title="Hide / show all drawings" icon={<Ico d={visible ? ICON.eye : ICON.eyeOff} />} active={!visible} onClick={() => setVisible((v) => !v)} />
                  <Tile label="Fit chart" title="Fit all candles in view" icon={<Ico d={ICON.fit} />} disabled={!api} onClick={() => { api?.fitContent(); setMenuOpen(false); }} />
                  <Tile label="Screenshot" title="Download chart as PNG" icon={<Ico d={ICON.camera} />} disabled={!api} onClick={() => { shot(); setMenuOpen(false); }} />
                  <Tile label="Clear all" title="Delete all drawings on this symbol" icon={<Ico d={ICON.trash} />} disabled={drawings.length === 0} onClick={() => { clearAll(); setMenuOpen(false); }} />
                </>
              ) : tab === "indicators" && indicators ? (
                <>
                  <div style={sectionLabel}>ON PRICE CHART</div>
                  {indicators.items.filter((i) => !PANE_INDICATORS.has(i.key)).map((i) => (
                    <Tile key={i.key} label={i.label} icon={<Ico d={indicatorIcon(i.key)} />} active={i.active} onClick={() => indicators.onToggle(i.key)} />
                  ))}
                  <div style={sectionLabel}>SEPARATE PANE BELOW CHART</div>
                  {indicators.items.filter((i) => PANE_INDICATORS.has(i.key)).map((i) => (
                    <Tile key={i.key} label={i.label} icon={<Ico d={indicatorIcon(i.key)} />} active={i.active} onClick={() => indicators.onToggle(i.key)} />
                  ))}
                </>
              ) : (
                catTools.map((t) => (
                  <Tile key={t.kind} label={TILE_LABEL[t.kind]} title={t.title} icon={<Ico d={TOOL_ICON[t.kind]} />} active={tool === t.kind} star={{ on: favs.includes(t.kind), onToggle: () => toggleFav(t.kind) }} onClick={() => { pickTool(t.kind); setMenuOpen(false); }} />
                ))
              )}
            </div>
            {tab === "favorites" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: `1px solid ${c.border.subtle}` }}>
                <Ico d={ICON.pencil} />
                <span style={{ flex: 1, fontSize: 15 }}>Show favorites on Chart</span>
                <button type="button" role="switch" aria-checked={showFavBar} aria-label="Show favorites on Chart" onClick={toggleFavBar}
                  style={{ width: 46, height: 26, borderRadius: 999, padding: 2, border: 0, cursor: "pointer", display: "flex", justifyContent: showFavBar ? "flex-end" : "flex-start", background: showFavBar ? c.accent.primary : c.border.strong }}>
                  <span style={{ width: 22, height: 22, borderRadius: "50%", background: c.text.primary }} />
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
      {selected && (
        <div role="toolbar" aria-label="Drawing properties" style={barStyle}>
          <span style={hint}>{toolOf(selected.kind)?.label ?? selected.kind}</span>
          {COLORABLE.has(selected.kind) && SWATCHES.map((col) => (
            <button key={col} type="button" aria-label="Set color" style={swatch(col, (selected.style?.color ?? c.accent.primary) === col)} disabled={!!selected.locked} onClick={() => setStyle({ color: col })} />
          ))}
          {STROKED.has(selected.kind) && <>
            <span style={sep} />
            {WIDTHS.map((n) => (
              <button key={n} type="button" style={btn((selected.style?.width ?? 2) === n, !!selected.locked)} disabled={!!selected.locked} title={`Line width ${n}`} onClick={() => setStyle({ width: n })}>{n}px</button>
            ))}
            <span style={sep} />
            {DASHES.map((s) => (
              <button key={s.id} type="button" style={btn((selected.style?.dash ?? "solid") === s.id, !!selected.locked)} disabled={!!selected.locked} onClick={() => setStyle({ dash: s.id })}>{s.label}</button>
            ))}
          </>}
          {(selected.kind === "text" || selected.kind === "label") && (
            <button type="button" style={btn(false, !!selected.locked)} disabled={!!selected.locked} onClick={editText}>Edit text</button>
          )}
          <span style={sep} />
          <button type="button" style={btn(!!selected.locked)} aria-pressed={!!selected.locked} title="Lock: no move, edit or delete" onClick={() => edit((d) => ({ ...d, locked: !d.locked }))}>{selected.locked ? "Locked" : "Lock"}</button>
          <button type="button" style={btn(false)} title="Duplicate" onClick={cloneSelected}>Clone</button>
          <button type="button" style={btn(false, !!selected.locked)} disabled={!!selected.locked} title="Delete selected (Del)" onClick={removeSelected}>Delete</button>
        </div>
      )}
      <div ref={wrapRef} onPointerMove={onWrapMove} onPointerLeave={() => { if (!dragRef.current) setHover("none"); }} style={{ position: "relative", minWidth: 0 }}>
        {children}
        {tool !== "cursor" && (
          <div aria-label="Drawing surface" onPointerDown={onDrawDown} onPointerMove={onDrawMove} onPointerUp={onDrawUp} onPointerCancel={cancelDraft}
            style={{ position: "absolute", inset: 0, cursor: "crosshair", touchAction: "none", zIndex: 5 }} />
        )}
        {showOverlay && (
          <div aria-label="Drawing grab layer" onPointerDown={onGrab} onPointerUp={endDrag} onPointerCancel={endDrag}
            style={{ position: "absolute", inset: 0, cursor: dragging ? "grabbing" : hover === "locked" ? "not-allowed" : "move", touchAction: "none", zIndex: 5 }} />
        )}
      </div>
    </div>
  );
}
