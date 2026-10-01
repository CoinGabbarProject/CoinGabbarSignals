import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from "react";
import type { Timeframe } from "../../../../shared/market.js";
import { tokens } from "../../../../shared/designTokens.js";
import { PERIOD_MS } from "../../../market/useLiveCandles.js";
import type { MarketChartApi } from "../types.js";
import { DrawingsPrimitive } from "./DrawingsPrimitive.js";
import { TOOLS, loadDrawings, newId, saveDrawings, toolOf } from "./model.js";
import type { Anchor, Drawing, DrawingKind } from "./model.js";

const c = tokens.color;
type Tool = DrawingKind | "cursor";

const btn = (active: boolean, disabled = false): CSSProperties => ({
  minHeight: 32, padding: "0 10px", borderRadius: 4, cursor: disabled ? "default" : "pointer", font: "inherit", fontSize: 12, flex: "0 0 auto",
  color: disabled ? c.text.disabled : active ? c.text.inverse : c.text.primary,
  background: active ? c.accent.primary : c.bg.elevated,
  border: `1px solid ${active ? c.accent.primary : c.border.default}`,
});
const barStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", overflowX: "auto", scrollbarWidth: "none" };
const sep: CSSProperties = { width: 1, alignSelf: "stretch", background: c.border.default, flex: "0 0 auto" };

export interface ChartDrawingToolsProps {
  api: MarketChartApi | null;
  symbol: string;
  timeframe: Timeframe;
  /** The chart itself; the drawing overlay is stacked on top of it. */
  children: ReactNode;
}

/** Drawing toolbar + click-to-place overlay. Drawings are saved per symbol in localStorage. */
export function ChartDrawingTools({ api, symbol, timeframe, children }: ChartDrawingToolsProps): ReactElement {
  const primRef = useRef<DrawingsPrimitive | null>(null);
  const placedRef = useRef<Anchor[]>([]);
  const [tool, setTool] = useState<Tool>("cursor");
  const [magnet, setMagnet] = useState(true);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placedCount, setPlacedCount] = useState(0);
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

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

  // load saved drawings when the symbol changes
  useEffect(() => {
    setDrawings(loadDrawings(symbol)); setSelectedId(null); setTool("cursor"); placedRef.current = []; setPlacedCount(0);
  }, [symbol]);

  useEffect(() => { primRef.current?.setState(drawings, selectedId); }, [api, drawings, selectedId]);
  useEffect(() => { primRef.current?.setPeriod(PERIOD_MS[timeframe] / 1000); }, [api, timeframe]);

  const commit = useCallback((next: Drawing[]): void => { setDrawings(next); saveDrawings(symbolRef.current, next); }, []);

  const cancelDraft = useCallback((): void => { placedRef.current = []; setPlacedCount(0); primRef.current?.setDraft(null); }, []);
  const pickTool = (t: Tool): void => { cancelDraft(); setSelectedId(null); setTool(t === tool ? "cursor" : t); };

  const removeSelected = useCallback((): void => {
    if (selectedId) { commit(drawings.filter((d) => d.id !== selectedId)); setSelectedId(null); }
  }, [commit, drawings, selectedId]);

  // select drawings by clicking them (cursor mode)
  useEffect(() => {
    if (!api || tool !== "cursor") return;
    const onClick = (p: { point?: { x: number; y: number } }): void => {
      if (p.point) setSelectedId(primRef.current?.hitTest(p.point.x, p.point.y) ?? null);
    };
    api.chart.subscribeClick(onClick);
    return () => { try { api.chart.unsubscribeClick(onClick); } catch { /* chart already removed */ } };
  }, [api, tool]);

  // keyboard: Delete removes selection, Esc cancels
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") { cancelDraft(); setTool("cursor"); setSelectedId(null); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) removeSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelDraft, removeSelected, selectedId]);

  const def = tool === "cursor" ? undefined : toolOf(tool);

  const draftFrom = (cursor: Anchor): Drawing | null => {
    if (!def || tool === "cursor") return null;
    const anchors = [...placedRef.current, cursor];
    while (anchors.length < def.points) anchors.push(cursor);
    return { id: "draft", kind: tool, anchors };
  };

  const anchorFromEvent = (e: ReactPointerEvent<HTMLDivElement>): Anchor | null => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (!api || x > api.chart.timeScale().width()) return null; // ignore the price-axis strip
    return primRef.current?.anchorAt(x, y, magnet) ?? null;
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (placedRef.current.length === 0) return;
    const a = anchorFromEvent(e);
    if (a) primRef.current?.setDraft(draftFrom(a));
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const a = anchorFromEvent(e);
    if (!a || !def || tool === "cursor") return;
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
    const d: Drawing = text ? { id: newId(), kind: tool, anchors: placed, text } : { id: newId(), kind: tool, anchors: placed };
    commit([...drawings, d]);
    cancelDraft(); setTool("cursor"); setSelectedId(d.id);
  };

  const clearAll = (): void => {
    if (drawings.length > 0 && window.confirm(`Delete all ${drawings.length} drawings on ${symbol}?`)) { commit([]); setSelectedId(null); }
  };

  return (
    <div style={{ minWidth: 0 }}>
      <div role="toolbar" aria-label="Drawing tools" style={barStyle}>
        <button type="button" style={btn(tool === "cursor")} aria-pressed={tool === "cursor"} title="Cursor / select" onClick={() => { cancelDraft(); setTool("cursor"); }}>Cursor</button>
        <span style={sep} />
        {TOOLS.map((t) => (
          <button key={t.kind} type="button" style={btn(tool === t.kind)} aria-pressed={tool === t.kind} title={t.title} onClick={() => pickTool(t.kind)}>{t.label}</button>
        ))}
        <span style={sep} />
        <button type="button" style={btn(magnet)} aria-pressed={magnet} title="Magnet: snap to candle open/high/low/close" onClick={() => setMagnet((m) => !m)}>Magnet</button>
        <button type="button" style={btn(false, drawings.length === 0)} disabled={drawings.length === 0} title="Undo last drawing" onClick={() => { commit(drawings.slice(0, -1)); setSelectedId(null); }}>Undo</button>
        <button type="button" style={btn(false, !selectedId)} disabled={!selectedId} title="Delete selected (Del)" onClick={removeSelected}>Delete</button>
        <button type="button" style={btn(false, drawings.length === 0)} disabled={drawings.length === 0} title="Clear all drawings" onClick={clearAll}>Clear</button>
        {def && <span role="status" style={{ fontSize: 12, color: c.text.muted, whiteSpace: "nowrap" }}>{def.title}: point {Math.min(placedCount + 1, def.points)}/{def.points}</span>}
      </div>
      <div style={{ position: "relative", minWidth: 0 }}>
        {children}
        {tool !== "cursor" && (
          <div aria-label="Drawing surface" onPointerDown={onDown} onPointerMove={onMove}
            style={{ position: "absolute", inset: 0, cursor: "crosshair", touchAction: "none", zIndex: 5 }} />
        )}
      </div>
    </div>
  );
}
