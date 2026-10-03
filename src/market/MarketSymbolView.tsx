import { useEffect, useMemo, useState } from "react";
import { fetchMarketSnapshot, type MarketSnapshotResponse } from "./marketApi.js";
import type { CSSProperties, ReactElement } from "react";
import type { Timeframe } from "../../shared/market.js";
import { tokens } from "../../shared/designTokens.js";
import { MarketChart } from "../components/MarketChart/index.js";
import { DEFAULT_INDICATORS, INDICATORS, SUB_PANE_HEIGHT, buildOverlays, subPaneCount } from "../components/MarketChart/indicatorOverlays.js";
import type { IndicatorKey } from "../components/MarketChart/indicatorOverlays.js";
import { TIMEFRAMES } from "./timeframes.js";
import { displaySymbol } from "./symbol.js";
import { useMarketCandles } from "./useMarketCandles.js";
import { useLiveCandles } from "./useLiveCandles.js";
import { ChartClock } from "./ChartClock.js";
import { ChartDrawingTools } from "../components/MarketChart/drawings/ChartDrawingTools.js";
import type { MarketChartApi } from "../components/MarketChart/index.js";

export const EMPTY_MESSAGE = "No market data available for this symbol/timeframe.";

const c = tokens.color;
const bar: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "8px 10px", minWidth: 0 };
const tfBtn = (active: boolean): CSSProperties => ({
  minHeight: 26, minWidth: 34, padding: "0 7px", borderRadius: 6, cursor: "pointer", font: "inherit", fontSize: 11, fontWeight: 600, lineHeight: 1,
  color: active ? c.text.inverse : c.text.primary,
  background: active ? c.accent.primary : c.bg.elevated,
  border: `1px solid ${active ? c.accent.primary : c.border.default}`,
});

/** Price text: 2 decimals from 100 up, up to 4 decimals from 1 up, up to 6 decimals below 1. */
const fmtPx = (n: number): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: n >= 100 ? 2 : 0, maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 4 : 6 });

/**
 * 24h open price from the public Binance ticker (no key), refreshed every 15s.
 * The header uses it with the live candle close, so the change follows the live price.
 */
function useOpen24h(symbol: string | null): number | null {
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    setOpen(null);
    if (!symbol) return;
    const ctrl = new AbortController();
    const load = (): void => {
      fetch(`https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<unknown>) : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => {
          const o = typeof j === "object" && j !== null ? (j as Record<string, unknown>) : {};
          const v = Number(o["openPrice"]);
          if (Number.isFinite(v) && v > 0) setOpen(v);
        })
        .catch(() => { /* keep the last value; the header just hides the change until the next refresh */ });
    };
    load();
    const id = window.setInterval(load, 15_000);
    return () => { ctrl.abort(); window.clearInterval(id); };
  }, [symbol]);
  return open;
}

/** Chart height follows the viewport class without hardcoding a width; the chart itself resizes to its container. */
function useChartHeight(): number {
  const query = "(max-width: 640px)";
  const [small, setSmall] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = (): void => setSmall(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return small ? 300 : 440;
}

export interface MarketSymbolViewProps {
  /** Exchange symbol from normalizeSymbol(), or null when the route symbol is not a tradable pair. */
  symbol: string | null;
  rawSymbol: string;
  timeframe: Timeframe;
  onTimeframeChange(tf: Timeframe): void;
}

/**
 * The chart stays mounted across symbol/timeframe changes (one Lightweight Charts instance);
 * only its data changes. Chart height is fixed, so loading/empty/error never shift the layout.
 */
export function MarketSymbolView({ symbol, rawSymbol, timeframe, onTimeframeChange }: MarketSymbolViewProps): ReactElement {
  const { status, candles: history, error, retry } = useMarketCandles(symbol, timeframe);
  const { candles, status: liveStatus } = useLiveCandles(symbol, timeframe, history, status === "ready", retry);
  const baseHeight = useChartHeight();
  const [chartApi, setChartApi] = useState<MarketChartApi | null>(null);
  const [snapshot, setSnapshot] = useState<MarketSnapshotResponse | null>(null);
  const [snapshotStatus, setSnapshotStatus] =
    useState<"idle" | "loading" | "ready" | "error">("idle");
  const [active, setActive] = useState<ReadonlySet<IndicatorKey>>(() => new Set(DEFAULT_INDICATORS));
  const overlays = useMemo(() => buildOverlays(active), [active]);
  const height = baseHeight + subPaneCount(active) * (SUB_PANE_HEIGHT + 8);
  const toggle = (k: IndicatorKey): void => setActive((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    const label = symbol ? displaySymbol(symbol) : rawSymbol;

  useEffect(() => {
    if (!symbol) {
      setSnapshot(null);
      return;
    }

    const controller = new AbortController();
    let activeRequest = true;

    setSnapshotStatus("loading");

    fetchMarketSnapshot(symbol, timeframe, controller.signal)
      .then((data) => {
        if (!activeRequest) return;
        setSnapshot(data);
        setSnapshotStatus("ready");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || !activeRequest) return;
        console.error("market snapshot error:", err);
        setSnapshotStatus("error");
      });

    return () => {
      activeRequest = false;
      controller.abort();
    };
  }, [symbol, timeframe]);

  const formatNumber = (value: number | null, digits = 2): string =>
    value === null || !Number.isFinite(value)
      ? "Unavailable"
      : value.toLocaleString(undefined, {
          maximumFractionDigits: digits,
        });

  const formatPercent = (value: number | null): string =>
    value === null || !Number.isFinite(value)
      ? "Unavailable"
      : `${value.toFixed(2)}%`;

  return (
    <section className="chartbox" aria-label={`${label} market chart`} style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div style={bar}>
        <strong style={{ marginRight: 8 }}>{label}</strong>
        <div role="group" aria-label="Timeframe" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {TIMEFRAMES.map((tf) => (
            <button key={tf} type="button" aria-pressed={tf === timeframe} style={tfBtn(tf === timeframe)} onClick={() => tf !== timeframe && onTimeframeChange(tf)}>
              {tf}
            </button>
          ))}
        </div>
        <ChartClock timeframe={timeframe} />
        {liveStatus !== "off" && (
          <span role="status" style={{ marginLeft: "auto", fontSize: 12, color: liveStatus === "live" ? c.positive.base : c.text.muted }}>
            {liveStatus === "live" ? "● Live" : liveStatus === "connecting" ? "Connecting…" : "Reconnecting…"}
          </span>
        )}
        {status === "error" && (
          <button type="button" style={{ ...tfBtn(false), marginLeft: "auto" }} onClick={retry}>Retry</button>
        )}
      </div>
      <div role="group" aria-label="Indicators" style={bar}>
        {INDICATORS.map((i) => (
          <button key={i.key} type="button" aria-pressed={active.has(i.key)} style={tfBtn(active.has(i.key))} onClick={() => toggle(i.key)}>{i.label}</button>
        ))}
      </div>
            {snapshot && snapshotStatus === "ready" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            order: 2,
            gap: 8,
            padding: "8px 10px",
          }}
          aria-label="Market analysis data"
        >
          <div className="data-card">
            <label>24H Change</label>
            <strong>{formatPercent(snapshot.ticker.change24hPct)}</strong>
          </div>

          <div className="data-card" style={snapshot.derivatives.fundingRate === null ? { display: "none" } : undefined}>
            <label>Funding</label>
            <strong>
              {snapshot.derivatives.fundingRate === null
                ? "Unavailable"
                : `${(snapshot.derivatives.fundingRate * 100).toFixed(4)}%`}
            </strong>
          </div>

          <div className="data-card" style={snapshot.derivatives.oiChangePct === null ? { display: "none" } : undefined}>
            <label>Open Interest</label>
            <strong>{formatPercent(snapshot.derivatives.oiChangePct)}</strong>
          </div>

          <div className="data-card" style={snapshot.derivatives.longShortRatio === null ? { display: "none" } : undefined}>
            <label>Long / Short</label>
            <strong>
              {formatNumber(snapshot.derivatives.longShortRatio, 2)}
            </strong>
          </div>

          <div className="data-card">
            <label>Order Book</label>
            <strong>
              {snapshot.orderBook.imbalance === null
                ? "Unavailable"
                : `${(snapshot.orderBook.imbalance * 100).toFixed(2)}%`}
            </strong>
          </div>

          <div className="data-card">
            <label>Spread</label>
            <strong>
              {formatNumber(snapshot.orderBook.spread, 8)}
            </strong>
          </div>

          <div className="data-card">
            <label>Midpoint</label>
            <strong>
              {formatNumber(snapshot.orderBook.midpoint, 8)}
            </strong>
          </div>

          <div className="data-card">
            <label>Data Status</label>
            <strong>
              {snapshotStatus === "ready" ? "Live" : "Unavailable"}
            </strong>
          </div>
        </div>
      )}

      {snapshotStatus === "error" && (
        <div
          role="status"
          style={{
            padding: "8px 10px",
            fontSize: 12,
            order: 2,
            color: c.text.muted,
          }}
        >
          Market-analysis data is temporarily unavailable. The chart remains available.
        </div>
      )}

      <div style={{ order: 1, minWidth: 0 }}>
      <ChartDrawingTools api={chartApi} symbol={label} timeframe={timeframe}>
        <MarketChart
          symbol={label}
          timeframe={timeframe}
          candles={candles}
          loading={status === "loading"}
          error={status === "error" ? error : null}
          height={height}
          overlays={overlays}
          onReady={setChartApi}
        />
      </ChartDrawingTools>
      </div>
    </section>
  );
}
