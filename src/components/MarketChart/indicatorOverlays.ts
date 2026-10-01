import { HistogramSeries, LineSeries } from "lightweight-charts";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../../../shared/market.js";
import { bollingerSeries, emaSeries, macdSeries, rsiSeries, smaSeries, vwapSeries } from "../../../shared/indicators.js";
import { msToChartTime } from "./candleAdapter.js";
import type { ChartOverlay, ChartOverlayContext } from "./types.js";

export type IndicatorKey = "ema20" | "ema50" | "sma200" | "bb" | "vwap" | "rsi" | "macd";
export const INDICATORS: readonly { key: IndicatorKey; label: string }[] = [
  { key: "ema20", label: "EMA 20" },
  { key: "ema50", label: "EMA 50" },
  { key: "sma200", label: "SMA 200" },
  { key: "bb", label: "Bollinger" },
  { key: "vwap", label: "VWAP" },
  { key: "rsi", label: "RSI" },
  { key: "macd", label: "MACD" },
];
export const DEFAULT_INDICATORS: readonly IndicatorKey[] = ["ema20", "ema50"];
export const SUB_PANE_HEIGHT = 130;

type Spec =
  | { kind: "line"; color: string; width?: 1 | 2 | 3 | 4; dashed?: boolean }
  | { kind: "hist" };

interface Options { pane?: number; paneHeight?: number; levels?: number[] }

const UP = "rgba(59, 227, 154, 0.7)";
const DOWN = "rgba(255, 92, 124, 0.7)";

/** compute() returns one number[] per spec, aligned 1:1 with candles (NaN = no value). */
function makeOverlay(id: string, specs: Spec[], compute: (c: Candle[]) => number[][], opts: Options = {}): ChartOverlay {
  let chart: IChartApi | null = null;
  let series: ISeriesApi<"Line" | "Histogram">[] = [];
  const pane = opts.pane ?? 0;

  return {
    id,
    attach(ctx: ChartOverlayContext): void {
      chart = ctx.api.chart;
      series = specs.map((s) => {
        if (s.kind === "hist") {
          return chart!.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
        }
        return chart!.addSeries(LineSeries, {
          color: s.color, lineWidth: s.width ?? 1, lineStyle: s.dashed ? 2 : 0,
          priceLineVisible: false, lastValueVisible: pane > 0, crosshairMarkerVisible: false,
        }, pane);
      });
      const first = series[0];
      if (first) for (const lv of opts.levels ?? []) first.createPriceLine({ price: lv, color: "#5b6b82", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" });
      if (pane > 0 && opts.paneHeight) chart.panes()[pane]?.setHeight(opts.paneHeight);
    },
    update(ctx: ChartOverlayContext): void {
      const values = compute([...ctx.candles]);
      specs.forEach((spec, k) => {
        const s = series[k], v = values[k];
        if (!s || !v) return;
        const data: { time: UTCTimestamp; value: number; color?: string }[] = [];
        ctx.candles.forEach((c, i) => {
          const value = v[i];
          if (value === undefined || !Number.isFinite(value)) return;
          const time = msToChartTime(c.timestamp);
          data.push(spec.kind === "hist" ? { time, value, color: value >= 0 ? UP : DOWN } : { time, value });
        });
        s.setData(data);
      });
    },
    detach(): void {
      if (chart) for (const s of series) { try { chart.removeSeries(s); } catch { /* chart already gone */ } }
      series = [];
      chart = null;
    },
  };
}

const closes = (c: Candle[]): number[] => c.map((x) => x.close);

export function buildOverlays(active: ReadonlySet<IndicatorKey>): ChartOverlay[] {
  const out: ChartOverlay[] = [];
  if (active.has("ema20")) out.push(makeOverlay("ema20", [{ kind: "line", color: "#f1a933", width: 2 }], (c) => [emaSeries(closes(c), 20)]));
  if (active.has("ema50")) out.push(makeOverlay("ema50", [{ kind: "line", color: "#8a79ff", width: 2 }], (c) => [emaSeries(closes(c), 50)]));
  if (active.has("sma200")) out.push(makeOverlay("sma200", [{ kind: "line", color: "#ffffff", width: 2 }], (c) => [smaSeries(closes(c), 200)]));
  if (active.has("vwap")) out.push(makeOverlay("vwap", [{ kind: "line", color: "#2cc7ff", width: 1, dashed: true }], (c) => [vwapSeries(c)]));
  if (active.has("bb")) {
    out.push(makeOverlay("bb", [
      { kind: "line", color: "#4f8cff" }, { kind: "line", color: "#4f8cff", dashed: true }, { kind: "line", color: "#4f8cff" },
    ], (c) => { const b = bollingerSeries(c); return [b.upper, b.middle, b.lower]; }));
  }
  let pane = 1;
  if (active.has("rsi")) {
    out.push(makeOverlay("rsi", [{ kind: "line", color: "#c78bff", width: 2 }], (c) => [rsiSeries(closes(c), 14)], { pane, paneHeight: SUB_PANE_HEIGHT, levels: [30, 70] }));
    pane++;
  }
  if (active.has("macd")) {
    out.push(makeOverlay("macd", [
      { kind: "hist" }, { kind: "line", color: "#2cc7ff", width: 1 }, { kind: "line", color: "#f1a933", width: 1 },
    ], (c) => { const m = macdSeries(c); return [m.hist, m.macd, m.signal]; }, { pane, paneHeight: SUB_PANE_HEIGHT }));
  }
  return out;
}

export const subPaneCount = (active: ReadonlySet<IndicatorKey>): number => (active.has("rsi") ? 1 : 0) + (active.has("macd") ? 1 : 0);
