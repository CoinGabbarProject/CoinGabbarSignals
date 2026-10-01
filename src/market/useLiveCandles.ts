import { useEffect, useMemo, useRef, useState } from "react";
import type { Candle, Timeframe } from "../../shared/market.js";
import { isValidCandle } from "./validateCandles.js";

export type LiveStatus = "off" | "connecting" | "live" | "reconnecting";

const INTERVAL: Record<Timeframe, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1H": "1h", "4H": "4h", "1D": "1d" };
export const PERIOD_MS: Record<Timeframe, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1H": 3_600_000, "4H": 14_400_000, "1D": 86_400_000,
};

/** Public Binance market-data stream (no key). Override with VITE_WS_BASE. */
const envWs: unknown = import.meta.env["VITE_WS_BASE"];
const WS_BASE: string = typeof envWs === "string" && envWs !== "" ? envWs : "wss://data-stream.binance.vision/ws";
const STALE_MS = 15_000;
const MAX_CANDLES = 1000;

interface Tick { key: string; candle: Candle }

function parseKline(raw: unknown): Candle | null {
  if (typeof raw !== "string") return null;
  let msg: unknown;
  try { msg = JSON.parse(raw); } catch { return null; }
  if (typeof msg !== "object" || msg === null) return null;
  const k = (msg as { k?: unknown }).k;
  if (typeof k !== "object" || k === null) return null;
  const r = k as Record<string, unknown>;
  const candle: Candle = { timestamp: Number(r["t"]), open: Number(r["o"]), high: Number(r["h"]), low: Number(r["l"]), close: Number(r["c"]), volume: Number(r["v"]) };
  return isValidCandle(candle) ? candle : null;
}

/** Pure merge: replace the forming bar, or append a newer one. Older/unknown ticks are ignored. */
export function mergeLive(base: readonly Candle[], tick: Candle, period: number): { candles: readonly Candle[]; gap: boolean } {
  const last = base[base.length - 1];
  if (!last || tick.timestamp < last.timestamp) return { candles: base, gap: false };
  if (tick.timestamp === last.timestamp) return { candles: [...base.slice(0, -1), tick], gap: false };
  const gap = tick.timestamp - last.timestamp > period * 1.5;
  const next = [...base, tick];
  return { candles: next.length > MAX_CANDLES ? next.slice(-MAX_CANDLES) : next, gap };
}

/**
 * Streams the forming candle over WebSocket and merges it into `base`.
 *  - Reconnects with backoff; a silent socket (phone sleep / dead network) is recycled after STALE_MS.
 *  - If candles were missed (gap), `onGap` is called once so the caller can re-fetch history.
 */
export function useLiveCandles(
  symbol: string | null, timeframe: Timeframe, base: readonly Candle[], enabled: boolean, onGap: () => void,
): { candles: readonly Candle[]; status: LiveStatus } {
  const key = `${symbol ?? ""}|${timeframe}`;
  const [tick, setTick] = useState<Tick | null>(null);
  const [status, setStatus] = useState<LiveStatus>("off");
  const onGapRef = useRef(onGap);
  onGapRef.current = onGap;

  useEffect(() => {
    if (!enabled || symbol === null) { setStatus("off"); return; }
    let ws: WebSocket | null = null;
    let closed = false;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let lastMsg = Date.now();
    setStatus("connecting");

    const connect = (): void => {
      if (closed) return;
      ws = new WebSocket(`${WS_BASE}/${symbol.toLowerCase()}@kline_${INTERVAL[timeframe]}`);
      ws.onopen = (): void => { retries = 0; lastMsg = Date.now(); setStatus("live"); };
      ws.onmessage = (e: MessageEvent): void => {
        lastMsg = Date.now();
        const candle = parseKline(e.data);
        if (candle) setTick({ key, candle });
      };
      ws.onclose = (): void => {
        if (closed) return;
        setStatus("reconnecting");
        retryTimer = setTimeout(connect, Math.min(15_000, 1000 * 2 ** retries++));
      };
      ws.onerror = (): void => { ws?.close(); };
    };
    connect();

    const watchdog = setInterval(() => {
      if (closed || !ws || Date.now() - lastMsg <= STALE_MS) return;
      lastMsg = Date.now();
      const old = ws;
      old.onopen = null; old.onclose = null; old.onerror = null; old.onmessage = null;
      old.close();
      setStatus("reconnecting");
      clearTimeout(retryTimer);
      connect();
    }, 5000);

    return () => {
      closed = true;
      clearInterval(watchdog);
      clearTimeout(retryTimer);
      if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close(); }
      setStatus("off");
    };
  }, [symbol, timeframe, enabled, key]);

  const merged = useMemo(() => {
    if (!enabled || !tick || tick.key !== key) return { candles: base, gap: false };
    return mergeLive(base, tick.candle, PERIOD_MS[timeframe]);
  }, [base, tick, key, enabled, timeframe]);

  const gapKey = merged.gap && tick ? `${tick.key}|${tick.candle.timestamp}` : null;
  const gapDone = useRef<string | null>(null);
  useEffect(() => {
    if (gapKey !== null && gapDone.current !== gapKey) { gapDone.current = gapKey; onGapRef.current(); }
  }, [gapKey]);

  return { candles: merged.candles, status };
}
