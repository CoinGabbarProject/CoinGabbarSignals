import { ColorType, CrosshairMode } from "lightweight-charts";
import type { CandlestickSeriesPartialOptions, ChartOptions, DeepPartial, HistogramSeriesPartialOptions } from "lightweight-charts";
import { tokens } from "../../../shared/designTokens.js";

/**
 * Canvas cannot resolve CSS variables, so the theme reads the same raw values
 * that generate tokens.css (shared/designTokens.ts is the single source of truth).
 */
const c = tokens.color;

export const volumeColors = { up: "rgba(59, 227, 154, 0.35)", down: "rgba(255, 92, 124, 0.35)" } as const;

export function baseChartOptions(height: number): DeepPartial<ChartOptions> {
  return {
    autoSize: true, // built-in ResizeObserver, disconnected by chart.remove()
    height,
    layout: {
      background: { type: ColorType.Solid, color: c.bg.panel },
      textColor: c.text.muted,
      fontFamily: tokens.font.family.mono,
      attributionLogo: true,
    },
    grid: { vertLines: { color: c.border.subtle }, horzLines: { color: c.border.subtle } },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { visible: true, borderColor: c.border.default },
    leftPriceScale: { visible: false },
    timeScale: { borderColor: c.border.default, timeVisible: true, secondsVisible: false, rightOffset: 4 },
    handleScroll: true,
    handleScale: true,
  };
}

export const candleSeriesOptions: CandlestickSeriesPartialOptions = {
  upColor: c.positive.base,
  downColor: c.negative.base,
  borderUpColor: c.positive.base,
  borderDownColor: c.negative.base,
  wickUpColor: c.positive.base,
  wickDownColor: c.negative.base,
};

export const volumeSeriesOptions: HistogramSeriesPartialOptions = {
  priceFormat: { type: "volume" },
  priceScaleId: "", // overlay scale: volume sits under the candles without taking the right axis
  lastValueVisible: false,
  priceLineVisible: false,
};

/** Fractions of the pane reserved so candles and volume don't collide. */
export const CANDLE_SCALE_MARGINS = { top: 0.06, bottom: 0.24 } as const;
export const VOLUME_SCALE_MARGINS = { top: 0.8, bottom: 0 } as const;
