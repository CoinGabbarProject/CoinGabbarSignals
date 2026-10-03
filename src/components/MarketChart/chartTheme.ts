import { ColorType, CrosshairMode } from "lightweight-charts";
import type { CandlestickSeriesPartialOptions, ChartOptions, DeepPartial, HistogramSeriesPartialOptions } from "lightweight-charts";
import { tokens } from "../../../shared/designTokens.js";

/**
 * Canvas cannot resolve CSS variables, so the theme reads the same raw values
 * that generate tokens.css (shared/designTokens.ts is the single source of truth).
 */
const c = tokens.color;

export const volumeColors = { up: "rgba(59, 227, 154, 0.35)", down: "rgba(255, 92, 124, 0.35)" } as const;

/** Canvas colours for the light page theme (set by the Settings page via <html data-theme="light">). */
const light = { bg: "#FFFFFF", text: "#5B6B80", grid: "#E6EDF5", border: "#D3DEEB" } as const;

function isLightTheme(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light";
}

/** Theme-dependent part of the chart options; re-applied when the theme changes. */
export function themedChartOptions(): DeepPartial<ChartOptions> {
  const l = isLightTheme();
  const bg = l ? light.bg : c.bg.panel, text = l ? light.text : c.text.muted;
  const grid = l ? light.grid : c.border.subtle, border = l ? light.border : c.border.default;
  return {
    layout: { background: { type: ColorType.Solid, color: bg }, textColor: text },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    rightPriceScale: { borderColor: border },
    timeScale: { borderColor: border },
  };
}

export function baseChartOptions(height: number): DeepPartial<ChartOptions> {
  const t = themedChartOptions();
  return {
    autoSize: true, // built-in ResizeObserver, disconnected by chart.remove()
    height,
    layout: { ...t.layout, fontFamily: tokens.font.family.mono, attributionLogo: true },
    grid: t.grid,
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { visible: true, ...t.rightPriceScale },
    leftPriceScale: { visible: false },
    timeScale: { ...t.timeScale, timeVisible: true, secondsVisible: false, rightOffset: 4 },
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

/** Price digits follow the coin: BTC 2dp, ~$1 coins 4dp, 0.000004 coins 9dp. */
export function priceFormatFor(p: number): { type: "price"; precision: number; minMove: number } {
  const v = Math.abs(p);
  let precision = 2;
  if (v > 0 && v < 1000) precision = v >= 1 ? 4 : Math.min(12, Math.ceil(-Math.log10(v)) + 3);
  return { type: "price", precision, minMove: 1 / 10 ** precision };
}

export const volumeSeriesOptions: HistogramSeriesPartialOptions = {
  priceFormat: { type: "volume" },
  priceScaleId: "", // overlay scale: volume sits under the candles without taking the right axis
  lastValueVisible: false,
  priceLineVisible: false,
};

/** Fractions of the pane reserved so candles and volume don't collide. */
export const CANDLE_SCALE_MARGINS = { top: 0.06, bottom: 0.24 } as const;
export const VOLUME_SCALE_MARGINS = { top: 0.8, bottom: 0 } as const;
