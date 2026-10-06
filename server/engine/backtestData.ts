import type { Candle, Timeframe } from "../../shared/market.js";
import { calcIndicators } from "../../shared/indicators.js";
import { CONFIRMATION_TF } from "./marketData.js";

/**
 * Backtest - part 1 of 3: historical data + time-alignment helpers.
 *
 *   part 1  backtestData.ts    (this file) paged OKX history, candle windows, BTC trend series
 *   part 2  backtest.ts        simulation core (walk candles, build signals, simulate trades)
 *   part 3  backtestReport.ts  statistics + text report, plus the /engine/backtest route
 *
 * Nothing here talks to the database or changes live behaviour.
 */

export const TF_MS: Record<Timeframe, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1H": 3_600_000, "4H": 14_400_000, "1D": 86_400_000,
};

/** Candles the live scanner hands to the strategy (candleLimit in server/index.ts). */
export const WINDOW = 300;
/** Extra candles before the first test bar so SMA200 / ADX / ATR are warm. */
export const WARMUP = 300;
/** Hard cap per series so a typo in ?days= cannot hammer OKX. */
export const MAX_HISTORY_BARS = 6000;
const PAGE = 100; // OKX history-candles maximum per request

export interface HistoryConfig { host: string; timeoutMs: number; pageDelayMs: number; retries: number }
export const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  host: "https://www.okx.com", timeoutMs: 10_000, pageDelayMs: 350, retries: 3,
};
const OKX_BAR: Record<Timeframe, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1H": "1H", "4H": "4H", "1D": "1Dutc" };

export type Bias = 1 | -1 | 0;

export interface SymbolHistory {
  symbol: string;
  timeframe: Timeframe;
  confTimeframe: Timeframe | null;
  primary: Candle[];
  confirmation: Candle[] | null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const toNum = (v: unknown): number =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;

function validCandle(c: Candle): boolean {
  return (
    isNum(c.timestamp) && isNum(c.open) && isNum(c.high) && isNum(c.low) && isNum(c.close) &&
    c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0 &&
    c.high >= c.low && c.high >= c.open && c.high >= c.close && c.low <= c.open && c.low <= c.close
  );
}

async function fetchPage(
  instId: string, tf: Timeframe, after: number | null, cfg: HistoryConfig, fetchFn: typeof fetch,
): Promise<unknown[]> {
  const url = new URL("/api/v5/market/history-candles", cfg.host);
  url.searchParams.set("instId", instId);
  url.searchParams.set("bar", OKX_BAR[tf]);
  url.searchParams.set("limit", String(PAGE));
  if (after !== null) url.searchParams.set("after", String(after)); // rows OLDER than this timestamp

  let lastErr: unknown;
  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    try {
      const res = await fetchFn(url.toString(), { signal: ctrl.signal, headers: { Accept: "application/json" } });
      let body: { code?: unknown; msg?: unknown; data?: unknown } | null = null;
      try { body = (await res.json()) as typeof body; } catch { body = null; }
      if (res.status === 429 || body?.code === "50011") throw new Error("rate limited");
      if (!body) throw new Error(`HTTP ${res.status}`);
      if (body.code !== "0") {
        throw Object.assign(new Error(`OKX ${String(body.code)}: ${String(body.msg)}`), { okxCode: String(body.code), fatal: body.code === "51001" });
      }
      if (!Array.isArray(body.data)) throw new Error("unexpected response shape");
      return body.data;
    } catch (e) {
      lastErr = e;
      if ((e as { fatal?: boolean }).fatal) throw e;
      if (attempt < cfg.retries) await sleep(800 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${instId} ${tf} history fetch failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

export async function fetchHistory(
  symbol: string, tf: Timeframe, bars: number, now: number,
  cfg: HistoryConfig = DEFAULT_HISTORY_CONFIG, fetchFn: typeof fetch = fetch,
): Promise<Candle[]> {
  const want = Math.min(Math.max(Math.trunc(bars), 1), MAX_HISTORY_BARS);
  const maxPages = Math.ceil(want / PAGE) + 2;
  const coin = symbol.replace(/USDT$/, "");
  let instId = `${coin}-USDT-SWAP`;
  const byTime = new Map<number, Candle>();
  let after: number | null = null;

  for (let page = 0; page < maxPages && byTime.size < want; page++) {
    let rows: unknown[];
    try {
      rows = await fetchPage(instId, tf, after, cfg, fetchFn);
    } catch (e) {
      if (page === 0 && (e as { okxCode?: string }).okxCode === "51001" && instId.endsWith("-SWAP")) {
        instId = `${coin}-USDT`;
        rows = await fetchPage(instId, tf, after, cfg, fetchFn);
      } else throw e;
    }
    if (rows.length === 0) break;
    let oldest = Infinity;
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const openTime = toNum(row[0]);
      if (!isNum(openTime)) continue;
      oldest = Math.min(oldest, openTime);
      if (openTime + TF_MS[tf] > now) continue; // forming candle
      const c: Candle = {
        timestamp: openTime, open: toNum(row[1]), high: toNum(row[2]),
        low: toNum(row[3]), close: toNum(row[4]), volume: toNum(row[6] ?? row[5]),
      };
      if (!isNum(c.volume) || c.volume < 0) c.volume = 0;
      if (validCandle(c)) byTime.set(openTime, c);
    }
    if (!Number.isFinite(oldest) || (after !== null && oldest >= after)) break;
    after = oldest;
    await sleep(cfg.pageDelayMs);
  }
  return [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-want);
}

/**
 * Primary candles (test bars + warm-up) and the confirmation-timeframe candles that cover the
 * same span. Errors are thrown on purpose: silently dropping the confirmation series would make
 * the backtest score differently from the live scanner.
 */
export async function loadSymbolHistory(
  symbol: string, tf: Timeframe, testBars: number, now: number,
  cfg: HistoryConfig = DEFAULT_HISTORY_CONFIG, fetchFn: typeof fetch = fetch,
): Promise<SymbolHistory> {
  const primary = await fetchHistory(symbol, tf, testBars + WARMUP, now, cfg, fetchFn);
  const confTf = CONFIRMATION_TF[tf];
  let confirmation: Candle[] | null = null;
  if (confTf) {
    const confBars = Math.ceil((primary.length * TF_MS[tf]) / TF_MS[confTf]) + WINDOW + 5;
    confirmation = await fetchHistory(symbol, confTf, confBars, now, cfg, fetchFn);
  }
  return { symbol, timeframe: tf, confTimeframe: confTf, primary, confirmation };
}

/** Number of test bars for a "last N days" request. */
export const barsForDays = (days: number, tf: Timeframe): number =>
  Math.max(1, Math.min(MAX_HISTORY_BARS - WARMUP, Math.ceil((days * 86_400_000) / TF_MS[tf])));

/** Index of the last candle fully closed at time `t` (timestamp + tfMs <= t), or -1. Candles ascending. */
export function lastClosedIndex(candles: Candle[], tfMs: number, t: number): number {
  let lo = 0, hi = candles.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = candles[mid];
    if (!c) break;
    if (c.timestamp + tfMs <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** The last `size` candles up to and including index `i` - exactly what the live scanner sees. */
export const windowAt = (candles: Candle[], i: number, size: number = WINDOW): Candle[] =>
  candles.slice(Math.max(0, i + 1 - size), i + 1);

/** Confirmation-timeframe window that was already closed at decision time `t`, or null. */
export function confirmationWindow(conf: Candle[] | null, confMs: number, t: number, size: number = WINDOW): Candle[] | null {
  if (!conf) return null;
  const j = lastClosedIndex(conf, confMs, t);
  return j < 0 ? null : conf.slice(Math.max(0, j + 1 - size), j + 1);
}

/** Rolling 24h change in percent at candle `i`, derived from candles (the live scanner uses the exchange ticker). */
export function change24hPct(candles: Candle[], i: number, tf: Timeframe): number | null {
  const bars = Math.max(1, Math.round(86_400_000 / TF_MS[tf]));
  const now = candles[i], then = candles[i - bars];
  if (!now || !then || then.close <= 0) return null;
  return ((now.close - then.close) / then.close) * 100;
}

/** Trend bias used by the BTC filter: 1 up, -1 down, 0 unclear. Same rule as btcBias() in scanner.ts. */
export function trendBias(candles: Candle[]): Bias {
  const ind = calcIndicators(candles);
  const k = candles[candles.length - 1];
  if (!ind || !k) return 0;
  if (ind.ema20 > ind.ema50 && k.close > ind.ema50) return 1;
  if (ind.ema20 < ind.ema50 && k.close < ind.ema50) return -1;
  return 0;
}

/** Bias after every candle, so the simulator can look it up instead of recomputing indicators per symbol per step. */
export function biasSeries(candles: Candle[]): Bias[] {
  return candles.map((_, i) => (i < 60 ? 0 : trendBias(windowAt(candles, i))));
}

/** BTC bias that was known at time `t` (uses only candles already closed then). */
export function biasAt(series: Bias[], candles: Candle[], tfMs: number, t: number): Bias {
  const i = lastClosedIndex(candles, tfMs, t);
  return i < 0 ? 0 : (series[i] ?? 0);
}
