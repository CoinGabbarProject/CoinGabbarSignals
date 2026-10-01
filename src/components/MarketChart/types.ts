import type { IChartApi, ISeriesApi, DeepPartial, ChartOptions } from "lightweight-charts";
import type { Candle, Timeframe } from "../../../shared/market.js";

/** Live handles to the chart objects. Overlays and future features use these; they are not copies. */
export interface MarketChartApi {
  chart: IChartApi;
  candleSeries: ISeriesApi<"Candlestick">;
  /** Null when volume is disabled or the candles carry no volume. */
  getVolumeSeries(): ISeriesApi<"Histogram"> | null;
  fitContent(): void;
}

export interface ChartOverlayContext {
  api: MarketChartApi;
  symbol: string;
  timeframe: Timeframe;
  /** The same Candle[] the chart was given (milliseconds timestamps, untouched). */
  candles: readonly Candle[];
}

/**
 * Extension point for everything drawn ON TOP of the candles: EMA, SMA, VWAP,
 * Bollinger Bands, support/resistance, FVG, SMC, entry / stop-loss / take-profit,
 * long/short markers. Part 1 ships NO implementations.
 *
 * Contract:
 *  - attach(): create your series / price lines / primitives on ctx.api.chart or ctx.api.candleSeries.
 *  - update(): called after the chart data changes; recompute from ctx.candles.
 *  - detach(): remove everything attach() created. Always called before the chart is destroyed.
 */
export interface ChartOverlay {
  readonly id: string;
  attach(ctx: ChartOverlayContext): void;
  update?(ctx: ChartOverlayContext): void;
  detach(): void;
}

export interface MarketChartProps {
  symbol: string;
  timeframe: Timeframe;
  /** Oldest first or unsorted; the adapter sorts and de-duplicates. Never fabricated here. */
  candles: readonly Candle[];
  loading?: boolean;
  error?: string | null;
  /** Pixel height of the chart area. Width always follows the container. Default 420. */
  height?: number;
  /** Default true. The volume series is only created when candles actually carry volume. */
  showVolume?: boolean;
  /** Raw Lightweight Charts option overrides, merged over the dark theme. */
  chartOptions?: DeepPartial<ChartOptions>;
  /** Stable array (memoize it): a new array identity re-attaches every overlay. */
  overlays?: readonly ChartOverlay[];
  /** Fired once per created chart instance. */
  onReady?(api: MarketChartApi): void;
  className?: string;
  }
