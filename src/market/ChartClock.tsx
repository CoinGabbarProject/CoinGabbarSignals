import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { Timeframe } from "../../shared/market.js";
import { tokens } from "../../shared/designTokens.js";
import { PERIOD_MS } from "./useLiveCandles.js";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Device-local wall clock, e.g. 00:18:22. */
export const fmtClock = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** Time left in the current candle. Binance candles are epoch-aligned (UTC), so no candle data is needed. */
export const candleLeftMs = (now: number, tf: Timeframe): number => PERIOD_MS[tf] - (now % PERIOD_MS[tf]);

export const fmtLeft = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
};

const box: CSSProperties = { display: "inline-flex", gap: 10, alignItems: "center", fontSize: 12, fontVariantNumeric: "tabular-nums", color: tokens.color.text.muted, whiteSpace: "nowrap" };

/** Live clock + countdown to the current candle's close. Ticks once per second. */
export function ChartClock({ timeframe }: { timeframe: Timeframe }): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={box} role="timer" aria-label="Current time and time left in this candle">
      <span title="Your local time">🕒 {fmtClock(now)}</span>
      <span title={`Time left until this ${timeframe} candle closes`}>⏳ {fmtLeft(candleLeftMs(now, timeframe))}</span>
    </span>
  );
}
