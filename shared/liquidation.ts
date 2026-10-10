import type { Liquidation } from "./market.js";

export interface LiquidationResult {
  events: number;
  longVolume: number;    // longs liquidated (forced selling)
  shortVolume: number;   // shorts liquidated (forced buying)
  dominant: "long" | "short" | "balanced";
  dominance: number;     // 0..1 share of the dominant side
  clusterLong: number | null;   // price level with most long liquidations
  clusterShort: number | null;  // price level with most short liquidations
}

/** Summarise recent liquidation events. Volume units are exchange contracts: only ratios matter. */
export function calcLiquidation(events: Liquidation[] | null | undefined, atr: number, now: number, windowMs = 6 * 3_600_000): LiquidationResult | null {
  if (!events || !(atr > 0)) return null;
  const recent = events.filter((e) => now - e.timestamp <= windowMs && e.price > 0 && e.quantity > 0);
  if (recent.length < 5) return null;
  let longVolume = 0, shortVolume = 0;
  const step = atr * 0.5;
  const binsL = new Map<number, number>(), binsS = new Map<number, number>();
  for (const e of recent) {
    const key = Math.round(e.price / step);
    if (e.side === "long") { longVolume += e.quantity; binsL.set(key, (binsL.get(key) ?? 0) + e.quantity); }
    else { shortVolume += e.quantity; binsS.set(key, (binsS.get(key) ?? 0) + e.quantity); }
  }
  const top = (m: Map<number, number>): number | null => {
    let bk: number | null = null, bv = 0;
    for (const [k, v] of m) if (v > bv) { bv = v; bk = k; }
    return bk === null ? null : bk * step;
  };
  const total = longVolume + shortVolume;
  const share = total > 0 ? Math.max(longVolume, shortVolume) / total : 0.5;
  const dominant = share < 0.65 ? "balanced" : longVolume > shortVolume ? "long" : "short";
  return { events: recent.length, longVolume, shortVolume, dominant, dominance: share, clusterLong: top(binsL), clusterShort: top(binsS) };
}

export interface LiquidationScore { pts: number; confirmations: string[]; conflicts: string[]; againstCascade: boolean }

/**
 * Long liquidations = forced sells. Once price reclaims the cluster (+0.25 ATR) it is a flush-and-reclaim
 * (bullish). While price stays below the cluster the cascade is still active (bearish). Shorts mirror this.
 * pts is clamped to [-3, +3].
 */
export function scoreLiquidation(r: LiquidationResult, s: 1 | -1, close: number, atr: number): LiquidationScore {
  const conf: string[] = [], conflicts: string[] = [];
  let pts = 0, againstCascade = false;
  if (r.dominant === "balanced") return { pts: 0, confirmations: conf, conflicts, againstCascade };
  const pct = Math.round(r.dominance * 100);

  if (r.dominant === "long" && r.clusterLong !== null) {
    const reclaimed = close > r.clusterLong + 0.25 * atr;
    if (reclaimed) {
      if (s > 0) { pts += 3; conf.push(`Liquidations: ${pct}% longs flushed, price reclaimed the cluster (bullish)`); }
      else { pts -= 2; conflicts.push("Liquidations: long flush already reclaimed, SHORT is late"); }
    } else if (s > 0) { pts -= 2; againstCascade = true; conflicts.push(`Liquidations: ${pct}% longs still being liquidated below the cluster`); }
    else { pts += 1; conf.push("Liquidations: long liquidation cascade still active"); }
  } else if (r.dominant === "short" && r.clusterShort !== null) {
    const reclaimed = close < r.clusterShort - 0.25 * atr;
    if (reclaimed) {
      if (s < 0) { pts += 3; conf.push(`Liquidations: ${pct}% shorts squeezed, price rejected the cluster (bearish)`); }
      else { pts -= 2; conflicts.push("Liquidations: short squeeze already rejected, LONG is late"); }
    } else if (s < 0) { pts -= 2; againstCascade = true; conflicts.push(`Liquidations: ${pct}% shorts still being liquidated above the cluster`); }
    else { pts += 1; conf.push("Liquidations: short squeeze still active"); }
  }
  return { pts: Math.max(-3, Math.min(3, pts)), confirmations: conf, conflicts, againstCascade };
      }
/** Plain-JSON summary of a LiquidationResult for storage and the dashboards. */
export function describeLiquidation(r: LiquidationResult, mode: string, pts: number): Record<string, unknown> {
  return {
    available: true, mode, pts, dominant: r.dominant, dominancePct: Math.round(r.dominance * 100), events: r.events,
    longVolume: r.longVolume, shortVolume: r.shortVolume, clusterLong: r.clusterLong, clusterShort: r.clusterShort,
  };
}

