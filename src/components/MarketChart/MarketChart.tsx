import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { CandlestickSeries, HistogramSeries, createChart } from "lightweight-charts";
import type { ISeriesApi } from "lightweight-charts";
import { adaptCandles } from "./candleAdapter.js";
import {
  CANDLE_SCALE_MARGINS, VOLUME_SCALE_MARGINS, baseChartOptions, candleSeriesOptions, priceFormatFor, volumeColors, volumeSeriesOptions,
} from "./chartTheme.js";
import type { ChartOverlayContext, MarketChartApi, MarketChartProps } from "./types.js";
import { tokens } from "../../../shared/designTokens.js";

const DEFAULT_HEIGHT = 420;

const rootStyle = (height: number): CSSProperties => ({
  position: "relative", width: "100%", minWidth: 0, height, overflow: "hidden",
});
const surfaceStyle: CSSProperties = { position: "absolute", inset: 0 };
const noticeStyle = (tone: "info" | "error"): CSSProperties => ({
  position: "absolute", top: 8, left: 8, right: 8, padding: "6px 10px", borderRadius: 4, fontSize: 12, pointerEvents: "none",
  background: tokens.color.bg.elevated,
  color: tone === "error" ? tokens.color.negative.base : tokens.color.text.muted,
  border: `1px solid ${tone === "error" ? tokens.color.negative.edge : tokens.color.border.default}`,
});

/**
 * Reusable Lightweight Charts candlestick (+ volume) chart.
 *
 * Lifecycle: ONE chart per mount. Data/timeframe/option changes update the existing
 * chart; they never recreate it. Unmount detaches overlays, then removes the chart
 * (which also disconnects the autoSize ResizeObserver).
 *
 * Hook order matters: the dependent effects are declared BEFORE the creation effect
 * so that on unmount React runs their cleanups (overlay.detach) before chart.remove().
 */
export function MarketChart({
  symbol, timeframe, candles, loading = false, error = null, height = DEFAULT_HEIGHT,
  showVolume = true, chartOptions, overlays, onReady, className,
}: MarketChartProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fittedKeyRef = useRef<string | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [api, setApi] = useState<MarketChartApi | null>(null);

  const adapted = useMemo(() => adaptCandles(candles, volumeColors), [candles]);

  // --- data -------------------------------------------------------------
  useEffect(() => {
    if (!api) return;
    const lastCandle = adapted.candles[adapted.candles.length - 1];
    if (lastCandle) api.candleSeries.applyOptions({ priceFormat: priceFormatFor(lastCandle.close) });
    api.candleSeries.setData(adapted.candles);

    const wantVolume = showVolume && adapted.hasVolume;
    if (wantVolume && !volumeRef.current) {
      const v = api.chart.addSeries(HistogramSeries, volumeSeriesOptions);
      v.priceScale().applyOptions({ scaleMargins: VOLUME_SCALE_MARGINS });
      volumeRef.current = v;
    } else if (!wantVolume && volumeRef.current) {
      api.chart.removeSeries(volumeRef.current);
      volumeRef.current = null;
    }
    volumeRef.current?.setData(adapted.volume);

    // Fit once per symbol+timeframe so live updates never reset the user's zoom/pan.
    const key = `${symbol}|${timeframe}`;
    if (adapted.candles.length > 0 && fittedKeyRef.current !== key) {
      api.fitContent();
      fittedKeyRef.current = key;
    }
  }, [api, adapted, showVolume, symbol, timeframe]);

  // --- timeframe-dependent axis -------------------------------------------
  useEffect(() => {
    api?.chart.timeScale().applyOptions({ timeVisible: timeframe !== "1D", secondsVisible: false });
  }, [api, timeframe]);

  // --- size & caller overrides --------------------------------------------
  useEffect(() => {
    api?.chart.applyOptions({ height });
  }, [api, height]);
  useEffect(() => {
    if (api && chartOptions) api.chart.applyOptions(chartOptions);
  }, [api, chartOptions]);

  // --- overlays (extension point; none implemented in Part 1) -------------
  const ctx = useMemo<ChartOverlayContext | null>(
    () => (api ? { api, symbol, timeframe, candles } : null),
    [api, symbol, timeframe, candles],
  );
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    const current = ctxRef.current;
    if (!api || !current || !overlays || overlays.length === 0) return;
    for (const o of overlays) o.attach(current);
    return () => { for (const o of overlays) o.detach(); };
  }, [api, overlays]);

  useEffect(() => {
    if (!ctx || !overlays) return;
    for (const o of overlays) o.update?.(ctx);
  }, [ctx, overlays, adapted]);

  // --- creation / destruction (runs once per mount) -----------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, baseChartOptions(height));
    const candleSeries = chart.addSeries(CandlestickSeries, candleSeriesOptions);
    candleSeries.priceScale().applyOptions({ scaleMargins: CANDLE_SCALE_MARGINS });

    const handle: MarketChartApi = {
      chart,
      candleSeries,
      getVolumeSeries: () => volumeRef.current,
      fitContent: () => chart.timeScale().fitContent(),
    };
    setApi(handle);
    onReadyRef.current?.(handle);

    return () => {
      setApi(null);
      volumeRef.current = null;
      fittedKeyRef.current = null;
      chart.remove(); // disposes series, listeners and the autoSize ResizeObserver
    };
    // Intentionally empty: height is applied by its own effect; recreating the chart per render is forbidden.
  }, []);

  const showEmpty = !loading && !error && adapted.candles.length === 0;

  return (
    <div className={className} style={rootStyle(height)} role="img" aria-label={`${symbol} ${timeframe} candlestick chart`} data-market-chart>
      <div ref={containerRef} style={surfaceStyle} />
      {loading && <div role="status" style={noticeStyle("info")}>Loading {symbol} {timeframe} candles…</div>}
      {error && <div role="alert" style={noticeStyle("error")}>{error}</div>}
      {showEmpty && <div role="status" style={noticeStyle("info")}>No market data available for this symbol/timeframe.</div>}
    </div>
  );
}
