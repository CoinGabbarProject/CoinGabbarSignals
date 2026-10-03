import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from "react";
import type { Timeframe } from "../../../../shared/market.js";
import { tokens } from "../../../../shared/designTokens.js";
import { PERIOD_MS } from "../../../market/useLiveCandles.js";
import type { MarketChartApi } from "../types.js";
import { DrawingsPrimitive } from "./DrawingsPrimitive.js";
import { CATEGORIES, TOOLS, completeAnchors, loadDrawings, newId, saveDrawings, toolOf } from "./model.js";
import type { Anchor, Category, DashStyle, DrawStyle, Drawing, DrawingKind } from "./model.js";

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
type SheetTab = "tools" | Category;
const SHEET_TABS: ReadonlyArray<{ id: SheetTab; label: string }> = [{ id: "tools", label: "Tools" }, ...CATEGORIES];

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

interface TileProps { label: string; title?: string; icon?: ReactNode; active?: boolean; disabled?: boolean; onClick(): void }
function Tile({ label, title, icon, active, disabled = false, onClick }: TileProps): ReactElement {
  return (
    <button type="button" title={title ?? label} aria-pressed={active} disabled={disabled} style={tileStyle(active === true, disabled)} onClick={onClick}>
      {icon}
      <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
}

interface DragState { id: string; handle: number; start: { x: number; y: number }; orig: Drawing[]; moved: boolean }

export interface ChartDrawingToolsProps {
  api: MarketChartApi | null;
  symbol: string;
  timeframe: Timeframe;
  /** The chart itself; the drawing overlay is stacked on top of it. */
  children: ReactNode;
}

/**
 * Drawing toolbar + interaction layer. Drawings are saved per symbol in localStorage.
 * Cursor mode: click selects, drag a handle edits one anchor, drag a body moves the whole drawing.
 */
export function ChartDrawingTools({ api, symbol, timeframe, children }: ChartDrawingToolsProps): ReactElement {
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
  const [tab, setTab] = useState<SheetTab>("tools");
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
    return () => window.removeEventListener("keydown", onKey);
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
    const k = toolOf(t)?.cat;
    if (k) setTab(k);
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
  const catTools = tab === "tools" ? [] : TOOLS.filter((t) => t.cat === tab);
  const showOverlay = tool === "cursor" && (hover !== "none" || dragging);

  return (
    <div style={{ minWidth: 0 }}>
      <div role="toolbar" aria-label="Drawing tools" style={barStyle}>
        <button type="button" style={btn(tool === "cursor")} aria-pressed={tool === "cursor"} title="Cursor / select" onClick={() => { cancelDraft(); setTool("cursor"); }}>Cursor</button>
        <span style={sep} />
        {CATEGORIES.map((k) => (
          <button key={k.id} type="button" style={btn(cat === k.id)} aria-pressed={cat === k.id} onClick={() => setCat(k.id)}>{k.label}</button>
        ))}
        <span style={sep} />
        <button type="button" style={btn(magnet)} aria-pressed={magnet} title="Magnet: snap to candle open/high/low/close" onClick={() => setMagnet((m) => !m)}>Magnet</button>
        <button type="button" style={btn(false, !canUndo)} disabled={!canUndo} title="Undo (Ctrl+Z)" onClick={undo}>Undo</button>
        <button type="button" style={btn(false, !canRedo)} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" onClick={redo}>Redo</button>
        <button type="button" style={btn(!visible)} aria-pressed={!visible} title="Hide / show all drawings" onClick={() => setVisible((v) => !v)}>{visible ? "Hide" : "Show"}</button>
        <button type="button" style={btn(false, !api)} disabled={!api} title="Fit all candles in view" onClick={() => api?.fitContent()}>Fit</button>
        <button type="button" style={btn(false, !api)} disabled={!api} title="Download chart as PNG" onClick={shot}>Shot</button>
        <button type="button" style={btn(false, drawings.length === 0)} disabled={drawings.length === 0} title="Clear all drawings" onClick={clearAll}>Clear</button>
      </div>
      <div role="toolbar" aria-label="Tools" style={barStyle}>
        {catTools.map((t) => (
          <button key={t.kind} type="button" style={btn(tool === t.kind)} aria-pressed={tool === t.kind} title={t.title} onClick={() => pickTool(t.kind)}>{t.label}</button>
        ))}
        {status && <span role="status" style={hint}>{status}</span>}
      </div>
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
