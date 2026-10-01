import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from "lightweight-charts";
import { tokens } from "../../../../shared/designTokens.js";
import { hitShapes, renderShapes, shapesFor } from "./geometry.js";
import type { Proj, Shape } from "./geometry.js";
import type { Anchor, Drawing } from "./model.js";

interface Bar { time: number; open: number; high: number; low: number; close: number }
type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

/**
 * One Lightweight Charts series primitive that paints every drawing in chart space, so drawings
 * follow pan/zoom/live candles automatically. Anchors are (time, price); time is mapped through
 * the candle list (and extrapolated past the last candle) so it survives timeframe changes.
 */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<"Candlestick"> | null = null;
  private requestUpdate: (() => void) | null = null;
  private bars: Bar[] = [];
  private period = 3600;
  private drawings: readonly Drawing[] = [];
  private selectedId: string | null = null;
  private draft: Drawing | null = null;
  private size = { w: 0, h: 0 };
  private readonly views: IPrimitivePaneView[];

  constructor() {
    const renderer: IPrimitivePaneRenderer = { draw: (target: Target) => this.draw(target) };
    this.views = [{ zOrder: () => "top", renderer: () => renderer }];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series as unknown as ISeriesApi<"Candlestick">;
    this.requestUpdate = p.requestUpdate;
  }
  detached(): void { this.chart = null; this.series = null; this.requestUpdate = null; }
  updateAllViews(): void { this.loadBars(); }
  paneViews(): readonly IPrimitivePaneView[] { return this.views; }

  setState(drawings: readonly Drawing[], selectedId: string | null): void { this.drawings = drawings; this.selectedId = selectedId; this.requestUpdate?.(); }
  setDraft(d: Drawing | null): void { this.draft = d; this.requestUpdate?.(); }
  setPeriod(seconds: number): void { this.period = seconds; this.requestUpdate?.(); }

  // ---- time <-> logical -------------------------------------------------
  private loadBars(): void {
    if (!this.series) return;
    const out: Bar[] = [];
    for (const it of this.series.data()) {
      if (typeof it.time !== "number" || !("open" in it)) continue;
      out.push({ time: it.time, open: it.open, high: it.high, low: it.low, close: it.close });
    }
    this.bars = out;
  }

  private timeToLogical(t: number): number {
    const b = this.bars, n = b.length, first = b[0], last = b[n - 1];
    if (!first || !last) return NaN;
    if (t <= first.time) return (t - first.time) / this.period;
    if (t >= last.time) return n - 1 + (t - last.time) / this.period;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((b[mid]?.time ?? 0) <= t) lo = mid; else hi = mid; }
    const a = b[lo], c = b[hi];
    if (!a || !c) return NaN;
    return lo + (t - a.time) / (c.time - a.time);
  }

  private logicalToTime(l: number): number {
    const b = this.bars, n = b.length, first = b[0], last = b[n - 1];
    if (!first || !last) return NaN;
    if (l <= 0) return first.time + l * this.period;
    if (l >= n - 1) return last.time + (l - (n - 1)) * this.period;
    const i = Math.floor(l), a = b[i], c = b[i + 1];
    if (!a || !c) return NaN;
    return a.time + (l - i) * (c.time - a.time);
  }

  private proj(): Proj | null {
    const chart = this.chart, series = this.series;
    if (!chart || !series || this.bars.length === 0) return null;
    const ts = chart.timeScale();
    return {
      x: (t) => ts.logicalToCoordinate(this.timeToLogical(t) as Logical) ?? NaN,
      y: (p) => series.priceToCoordinate(p) ?? NaN,
      W: this.size.w, H: this.size.h, period: this.period,
    };
  }

  // ---- public helpers for the interaction layer ---------------------------
  /** Pixel (inside the pane) -> anchor. With `magnet`, snaps to the nearest O/H/L/C within 14px. */
  anchorAt(x: number, y: number, magnet: boolean): Anchor | null {
    if (!this.chart || !this.series) return null;
    if (this.bars.length === 0) this.loadBars();
    const l = this.chart.timeScale().coordinateToLogical(x);
    const p0 = this.series.coordinateToPrice(y);
    if (l === null || p0 === null) return null;
    let time = this.logicalToTime(l), price: number = p0;
    const bar = magnet ? this.bars[Math.round(l)] : undefined;
    if (bar) {
      let best = 14;
      for (const v of [bar.open, bar.high, bar.low, bar.close]) {
        const py = this.series.priceToCoordinate(v);
        if (py !== null && Math.abs(py - y) < best) { best = Math.abs(py - y); price = v; time = bar.time; }
      }
    }
    return Number.isFinite(time) ? { time, price } : null;
  }

  /** Topmost drawing under the pixel, or null. */
  hitTest(x: number, y: number): string | null {
    const P = this.proj();
    if (!P) return null;
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (d && hitShapes(shapesFor(d, P), x, y)) return d.id;
    }
    return null;
  }

  // ---- painting ---------------------------------------------------------
  private draw(target: Target): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      this.size = { w: mediaSize.width, h: mediaSize.height };
      const P = this.proj();
      if (!P) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, mediaSize.width, mediaSize.height); ctx.clip();
      const all: Drawing[] = this.draft ? [...this.drawings, this.draft] : [...this.drawings];
      for (const d of all) {
        const shapes: Shape[] = shapesFor(d, P);
        renderShapes(ctx, shapes);
        if (d.id === this.selectedId) {
          ctx.fillStyle = tokens.color.text.primary; ctx.strokeStyle = tokens.color.accent.primary; ctx.lineWidth = 2;
          for (const a of d.anchors) {
            const x = P.x(a.time), y = P.y(a.price);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
        }
      }
      ctx.restore();
    });
  }
}
