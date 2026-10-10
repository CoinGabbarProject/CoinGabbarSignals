import type { Candle } from "./market.js";

export type SmcSide = "bullish" | "bearish";
export interface OrderBlock { side: SmcSide; high: number; low: number; index: number; mitigated: boolean }
export interface FairValueGap { side: SmcSide; high: number; low: number; index: number; filled: boolean }
export interface StructureBreak { type: "BOS" | "CHOCH"; side: SmcSide; level: number; barsAgo: number }
export interface LiquiditySweep { side: SmcSide; level: number; barsAgo: number }
export interface SmcResult {
  trend: SmcSide | "range";
  lastBreak: StructureBreak | null;
  orderBlocks: OrderBlock[];   // newest first, unmitigated only
  fvgs: FairValueGap[];        // newest first, unfilled only
  sweep: LiquiditySweep | null;
  zone: "premium" | "discount" | "equilibrium";
  rangeHigh: number;
  rangeLow: number;
}

const L = 3;
const R = 3;

/** Smart Money Concepts on CLOSED candles (oldest first). Pure function, no I/O. */
export function calcSmc(candles: Candle[], atr: number): SmcResult | null {
  const n = candles.length;
  if (n < 40 || !(atr > 0)) return null;
  const cd = (i: number): Candle => candles[i] as Candle;

  const isPivotHigh = (i: number): boolean => {
    for (let j = i - L; j <= i + R; j++) if (j !== i && cd(j).high > cd(i).high) return false;
    return true;
  };
  const isPivotLow = (i: number): boolean => {
    for (let j = i - L; j <= i + R; j++) if (j !== i && cd(j).low < cd(i).low) return false;
    return true;
  };

  // ---- market structure: BOS / CHoCH + order blocks ----
  let trend: SmcSide | "range" = "range";
  let sh: { p: number; broken: boolean } | null = null;
  let sl: { p: number; broken: boolean } | null = null;
  let lastBreak: (Omit<StructureBreak, "barsAgo"> & { idx: number }) | null = null;
  const obs: OrderBlock[] = [];
  const pivotLows: Array<{ i: number; p: number }> = [];
  const pivotHighs: Array<{ i: number; p: number }> = [];

  for (let j = 0; j < n; j++) {
    const c = j - R;
    if (c >= L) {
      if (isPivotHigh(c)) { sh = { p: cd(c).high, broken: false }; pivotHighs.push({ i: c, p: cd(c).high }); }
      if (isPivotLow(c)) { sl = { p: cd(c).low, broken: false }; pivotLows.push({ i: c, p: cd(c).low }); }
    }
    const close = cd(j).close;
    if (sh && !sh.broken && close > sh.p) {
      lastBreak = { type: trend === "bearish" ? "CHOCH" : "BOS", side: "bullish", level: sh.p, idx: j };
      trend = "bullish"; sh.broken = true;
      for (let k = j - 1; k >= Math.max(0, j - 15); k--) {
        if (cd(k).close < cd(k).open) { obs.push({ side: "bullish", high: cd(k).high, low: cd(k).low, index: k, mitigated: false }); break; }
      }
    } else if (sl && !sl.broken && close < sl.p) {
      lastBreak = { type: trend === "bullish" ? "CHOCH" : "BOS", side: "bearish", level: sl.p, idx: j };
      trend = "bearish"; sl.broken = true;
      for (let k = j - 1; k >= Math.max(0, j - 15); k--) {
        if (cd(k).close > cd(k).open) { obs.push({ side: "bearish", high: cd(k).high, low: cd(k).low, index: k, mitigated: false }); break; }
      }
    }
  }

  // mitigation: a later CLOSE beyond the far side of the block invalidates it
  for (const ob of obs) {
    for (let j = ob.index + 1; j < n; j++) {
      if (ob.side === "bullish" ? cd(j).close < ob.low : cd(j).close > ob.high) { ob.mitigated = true; break; }
    }
  }
  const orderBlocks = obs.filter((o) => !o.mitigated && n - 1 - o.index <= 120).reverse();

  // ---- fair value gaps (3-candle imbalance, at least 0.2 ATR tall) ----
  const gaps: FairValueGap[] = [];
  for (let i = Math.max(2, n - 80); i < n; i++) {
    const a = cd(i - 2), c = cd(i);
    if (a.high < c.low && c.low - a.high >= 0.2 * atr) gaps.push({ side: "bullish", high: c.low, low: a.high, index: i, filled: false });
    else if (a.low > c.high && a.low - c.high >= 0.2 * atr) gaps.push({ side: "bearish", high: a.low, low: c.high, index: i, filled: false });
  }
  for (const g of gaps) {
    for (let j = g.index + 1; j < n; j++) {
      if (g.side === "bullish" ? cd(j).low <= g.low : cd(j).high >= g.high) { g.filled = true; break; }
    }
  }
  const fvgs = gaps.filter((g) => !g.filled).reverse();

  // ---- liquidity sweep: wick through an older swing point, close back inside, within last 6 candles ----
  let sweep: LiquiditySweep | null = null;
  for (let j = n - 1; j >= n - 6 && !sweep; j--) {
    const k = cd(j);
    for (const pl of pivotLows) {
      if (pl.i < j - 1 && k.low < pl.p && k.close > pl.p) { sweep = { side: "bullish", level: pl.p, barsAgo: n - 1 - j }; break; }
    }
    if (sweep) break;
    for (const ph of pivotHighs) {
      if (ph.i < j - 1 && k.high > ph.p && k.close < ph.p) { sweep = { side: "bearish", level: ph.p, barsAgo: n - 1 - j }; break; }
    }
  }

  // ---- premium / discount of the last 50 candles ----
  const win = candles.slice(-50);
  const rangeHigh = Math.max(...win.map((x) => x.high));
  const rangeLow = Math.min(...win.map((x) => x.low));
  const mid = (rangeHigh + rangeLow) / 2, band = (rangeHigh - rangeLow) * 0.05;
  const px = cd(n - 1).close;
  const zone = px < mid - band ? "discount" : px > mid + band ? "premium" : "equilibrium";

  return {
    trend,
    lastBreak: lastBreak ? { type: lastBreak.type, side: lastBreak.side, level: lastBreak.level, barsAgo: n - 1 - lastBreak.idx } : null,
    orderBlocks, fvgs, sweep, zone, rangeHigh, rangeLow,
  };
}

export interface SmcScore { pts: number; confirmations: string[]; conflicts: string[]; hasConfluence: boolean; againstRecentBreak: boolean }

/** Turn an SmcResult into points for a LONG (s = 1) or SHORT (s = -1). pts is clamped to [-4, +5]. */
export function scoreSmc(r: SmcResult, s: 1 | -1, close: number, atr: number): SmcScore {
  const want: SmcSide = s > 0 ? "bullish" : "bearish";
  const conf: string[] = [], conflicts: string[] = [];
  let pts = 0, hasConfluence = false, againstRecentBreak = false;

  const lb = r.lastBreak;
  if (lb && lb.barsAgo <= 30) {
    if (lb.side === want) { pts += lb.type === "CHOCH" ? 2 : 1; hasConfluence = true; conf.push(`SMC: ${lb.side} ${lb.type === "CHOCH" ? "CHoCH" : "BOS"} ${lb.barsAgo} candles ago`); }
    else if (lb.barsAgo <= 15) { pts -= 2; againstRecentBreak = true; conflicts.push(`SMC: recent ${lb.side} ${lb.type === "CHOCH" ? "CHoCH" : "BOS"} is against the setup`); }
  }
  const ob = r.orderBlocks.find((o) => o.side === want && close >= o.low - 0.25 * atr && close <= o.high + 0.25 * atr);
  if (ob) { pts += 2; hasConfluence = true; conf.push(`SMC: price is at an unmitigated ${want} order block`); }
  const gap = r.fvgs.find((g) => g.side === want && close >= g.low - 0.5 * atr && close <= g.high + 1 * atr);
  if (gap) { pts += 1; hasConfluence = true; conf.push(`SMC: ${want} fair value gap nearby`); }
  if (r.sweep && r.sweep.side === want && r.sweep.barsAgo <= 5) { pts += 2; hasConfluence = true; conf.push(`SMC: liquidity sweep and reclaim (${r.sweep.barsAgo} candles ago)`); }
  if (r.zone === (s > 0 ? "discount" : "premium")) pts += 1;
  else if (r.zone === (s > 0 ? "premium" : "discount")) { pts -= 1; conflicts.push(`SMC: ${r.zone} zone is expensive for a ${s > 0 ? "LONG" : "SHORT"}`); }

  return { pts: Math.max(-4, Math.min(5, pts)), confirmations: conf, conflicts, hasConfluence, againstRecentBreak };
}
/** Plain-JSON summary of an SmcResult for storage and the dashboards. Levels are direction-aware (same side as the trade). */
export function describeSmc(r: SmcResult, mode: string, pts: number, s: 1 | -1, close: number, atr: number): Record<string, unknown> {
  const want: SmcSide = s > 0 ? "bullish" : "bearish";
  const near = (lo: number, hi: number, below: number, above: number): boolean => close >= lo - below * atr && close <= hi + above * atr;
  const ob = r.orderBlocks.find((o) => o.side === want && near(o.low, o.high, 0.25, 0.25)) ?? r.orderBlocks.find((o) => o.side === want) ?? null;
  const gap = r.fvgs.find((g) => g.side === want && near(g.low, g.high, 0.5, 1)) ?? r.fvgs.find((g) => g.side === want) ?? null;
  return {
    available: true, mode, pts, trend: r.trend, zone: r.zone, rangeHigh: r.rangeHigh, rangeLow: r.rangeLow,
    lastBreak: r.lastBreak,
    orderBlock: ob ? { side: ob.side, low: ob.low, high: ob.high, atPrice: near(ob.low, ob.high, 0.25, 0.25) } : null,
    fvg: gap ? { side: gap.side, low: gap.low, high: gap.high, atPrice: near(gap.low, gap.high, 0.5, 1) } : null,
    sweep: r.sweep,
  };
}
                                                                                                                                                 
