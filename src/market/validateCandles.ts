import type { Candle } from "../../shared/market.js";

export interface ValidatedCandles {
  /** Strictly ascending by timestamp, unique timestamps, every OHLC invariant satisfied. */
  candles: Candle[];
  /** How many input rows were rejected (malformed, impossible OHLC, or superseded duplicates). */
  rejected: number;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function isValidCandle(c: Candle): boolean {
  if (!finite(c.timestamp) || c.timestamp <= 0) return false;
  if (!finite(c.open) || !finite(c.high) || !finite(c.low) || !finite(c.close)) return false;
  if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) return false;
  if (c.high < Math.max(c.open, c.close)) return false;
  if (c.low > Math.min(c.open, c.close)) return false;
  return c.low <= c.high;
}

/**
 * Validates, sorts and de-duplicates. Prices are never altered and no candle is invented.
 * Duplicate timestamps: the LAST valid occurrence in the input wins (a re-sent bar supersedes the earlier one).
 * A non-finite or negative volume is not a reason to drop a good price bar: it is zeroed so the chart omits it.
 */
export function validateCandles(input: readonly Candle[]): ValidatedCandles {
  const byTime = new Map<number, Candle>();
  let rejected = 0;
  for (const c of input) {
    if (!isValidCandle(c)) { rejected++; continue; }
    if (byTime.has(c.timestamp)) rejected++;
    byTime.set(c.timestamp, finite(c.volume) && c.volume >= 0 ? c : { ...c, volume: 0 });
  }
  const candles = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
  return { candles, rejected };
}
