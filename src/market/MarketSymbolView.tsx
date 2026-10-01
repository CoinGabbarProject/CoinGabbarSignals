import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { Timeframe } from "../../shared/market.js";
import { tokens } from "../../shared/designTokens.js";
import { MarketChart } from "../components/MarketChart/index.js";
import { TIMEFRAMES } from "./timeframes.js";
import { displaySymbol } from "./symbol.js";
import { useMarketCandles } from "./useMarketCandles.js";

export const EMPTY_MESSAGE = "No market data available for this symbol/timeframe.";

const c = tokens.color;
const bar: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "8px 10px", minWidth: 0 };
const tfBtn = (active: boolean): CSSProperties => ({
  minHeight: 32, minWidth: 40, padding: "0 10px", borderRadius: 4, cursor: "pointer", font: "inherit", fontSize: 12,
  color: active ? c.text.inverse : c.text.primary,
  background: active ? c.accent.primary : c.bg.elevated,
  border: `1px solid ${active ? c.accent.primary : c.border.default}`,
});

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
  const { status, candles, error, retry } = useMarketCandles(symbol, timeframe);
  const height = useChartHeight();
  const label = symbol ? displaySymbol(symbol) : rawSymbol;

  return (
    <section className="chartbox" aria-label={`${label} market chart`} style={{ minWidth: 0 }}>
      <div style={bar}>
        <strong style={{ marginRight: 8 }}>{label}</strong>
        <div role="group" aria-label="Timeframe" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {TIMEFRAMES.map((tf) => (
            <button key={tf} type="button" aria-pressed={tf === timeframe} style={tfBtn(tf === timeframe)} onClick={() => tf !== timeframe && onTimeframeChange(tf)}>
              {tf}
            </button>
          ))}
        </div>
        {status === "error" && (
          <button type="button" style={{ ...tfBtn(false), marginLeft: "auto" }} onClick={retry}>Retry</button>
        )}
      </div>
      <MarketChart
        symbol={label}
        timeframe={timeframe}
        candles={candles}
        loading={status === "loading"}
        error={status === "error" ? error : null}
        height={height}
      />
    </section>
  );
}
