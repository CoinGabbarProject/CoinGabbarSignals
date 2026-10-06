import type { Candle } from "./market.js";
import { calcAdvanced, calcIndicators } from "./indicators.js";

export type ScoreSide = "LONG" | "SHORT" | "NEUTRAL";

// Same shape as FinalSignal["score"] in server/models/signal.ts
export interface SetupScore {
  total: number; marketContext: number; trendMTF: number; structure: number; liquiditySR: number;
  volumeMomentum: number; derivativesOrderbook: number; newsFundamentals: number; riskExecution: number;
}

export const SCORE_MAX: SetupScore = {
  total: 100, marketContext: 10, trendMTF: 20, structure: 15, liquiditySR: 10,
  volumeMomentum: 15, derivativesOrderbook: 10, newsFundamentals: 5, riskExecution: 15,
};

export interface DerivativesInput { fundingRate: number | null; oiChangePct: number | null; longShortRatio: number | null; bookImbalance: number | null; topTraderRatio?: number | null; takerBuySellRatio?: number | null; }
export interface NewsInput { sentiment: number; highImpactSoon: boolean; }
export interface ScoreInput {
  candles: Candle[];
  confirmation?: Candle[] | null;
  change24hPct?: number | null;
  derivatives?: Partial<DerivativesInput> | null;
  news?: NewsInput | null;
}
export interface ScoreResult {
  side: ScoreSide; score: SetupScore;
  confirmations: string[]; conflicts: string[]; warnings: string[]; unavailable: string[];
  criticalFailure: string | null;
}

const zeroScore = (): SetupScore => ({
  total: 0, marketContext: 0, trendMTF: 0, structure: 0, liquiditySR: 0,
  volumeMomentum: 0, derivativesOrderbook: 0, newsFundamentals: 0, riskExecution: 0,
});
const clamp = (v: number, max: number): number => Math.max(0, Math.min(max, v));
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const hiOf = (a: Candle[]): number => Math.max(...a.map((x) => x.high));
const loOf = (a: Candle[]): number => Math.min(...a.map((x) => x.low));

function early(side: ScoreSide, criticalFailure: string | null, warnings: string[] = []): ScoreResult {
  return { side, score: zeroScore(), confirmations: [], conflicts: [], warnings, unavailable: [], criticalFailure };
}

/**
 * 100-point Setup Score. Strength measure only - not accuracy or win probability.
 * Missing optional data (confirmation TF, derivatives, news) scores 0 for that part
 * and is listed in `unavailable`. A criticalFailure must force NO_TRADE in Step 4.
 */
export function scoreSetup(input: ScoreInput): ScoreResult {
  const { candles } = input;
  const ind = calcIndicators(candles);
  const adv = calcAdvanced(candles);
  const k = candles[candles.length - 1];
  if (!ind || !adv || !k) return early("NEUTRAL", "Insufficient or invalid candle data");
  const atr = ind.atr.value;
  if (!Number.isFinite(atr) || atr <= 0) return early("NEUTRAL", "ATR unavailable");
  const close = k.close;

  // ---- direction: 5 votes ----
  const v = (b: boolean): number => (b ? 1 : -1);
  const votes =
    v(ind.ema20 > ind.ema50) + v(close > ind.ema50) + v(ind.macd.histogram > 0) +
    (adv.adx.bias === "bullish" ? 1 : adv.adx.bias === "bearish" ? -1 : 0) +
    (ind.vwap.relationship === "above" ? 1 : ind.vwap.relationship === "below" ? -1 : 0);
  const side: ScoreSide = votes >= 2 ? "LONG" : votes <= -2 ? "SHORT" : "NEUTRAL";
  if (side === "NEUTRAL") return early("NEUTRAL", null, ["No clear directional bias"]);
  const s = side === "LONG" ? 1 : -1;
  const want = { dir: s > 0 ? "up" : "down", bias: s > 0 ? "bullish" : "bearish", opp: s > 0 ? "bearish" : "bullish" } as const;

  const conf: string[] = [], conflicts: string[] = [], warnings: string[] = [], unavailable: string[] = [];
  let critical: string | null = null;
  const n = candles.length;
  const closeAgo = (b: number): number => candles[n - 1 - b]?.close ?? close;

  const { nearestSupport: ns, nearestResistance: nr } = adv.levels;
  const ahead = s > 0 ? nr : ns;
  const behind = s > 0 ? ns : nr;

  // ---- 1. Market context (10) ----
  let mc = 0;
  const adxPts = adv.adx.strength === "very-strong" ? 4 : adv.adx.strength === "strong" ? 3 : adv.adx.strength === "weak" ? 1 : 0;
  if (adv.adx.bias === want.bias) {
    mc += adxPts;
    if (adxPts >= 3) conf.push(`ADX ${adv.adx.adx.toFixed(0)}: strong trend with ${side} bias`);
  } else if (adxPts >= 3) conflicts.push("Strong ADX trend is against the setup");
  const atrPct = (atr / close) * 100;
  if (atrPct >= 0.3 && atrPct <= 6) mc += 3;
  else { mc += 1; warnings.push(`ATR is ${atrPct.toFixed(2)}% of price: ${atrPct < 0.3 ? "very quiet" : "very volatile"} market`); }
  const ch = input.change24hPct;
  if (!num(ch)) unavailable.push("change24h");
  else if (ch * s > 0.5) mc += 3;
  else if (ch * s >= -0.5) mc += 1;
  else conflicts.push("24h move is against the setup");

  // ---- 2. Trend + multi-timeframe (20) ----
  let tr = 0;
  if ((ind.ema20 - ind.ema50) * s > 0) { tr += 4; conf.push("EMA20/EMA50 aligned with the setup"); }
  else conflicts.push("EMA20/EMA50 against the setup");
  if ((close - ind.ema50) * s > 0) tr += 3;
  if (ind.sma200 === null) tr += 1;
  else if ((close - ind.sma200) * s > 0) { tr += 3; conf.push("Price on the right side of SMA200"); }
  else conflicts.push("Price on the wrong side of SMA200");
  if (ind.bollinger.direction === want.dir) tr += 2;
  const cInd = input.confirmation ? calcIndicators(input.confirmation) : null;
  const cLast = input.confirmation?.[input.confirmation.length - 1];
  if (!cInd || !cLast) unavailable.push("confirmationTF");
  else {
    let ct = 0;
    if ((cInd.ema20 - cInd.ema50) * s > 0) ct += 4;
    else {
      conflicts.push("Confirmation timeframe trend disagrees");
      critical = critical ?? "Higher timeframe trend disagrees with the setup";
    }
    if ((cLast.close - cInd.ema50) * s > 0) ct += 2;
    if (cInd.macd.histogram * s > 0) ct += 2;
    if (ct >= 6) conf.push("Confirmation timeframe agrees");
    tr += ct;
  }

  // ---- 3. Structure (15) ----
  let st = 0;
  const recent = candles.slice(-10), prior = candles.slice(-20, -10);
  const hh = hiOf(recent) > hiOf(prior), hl = loOf(recent) > loOf(prior);
  const lh = hiOf(recent) < hiOf(prior), ll = loOf(recent) < loOf(prior);
  const goodSwing = (s > 0 ? [hh, hl] : [lh, ll]).filter(Boolean).length;
  st += goodSwing * 3;
  if (goodSwing === 2) conf.push(s > 0 ? "Higher highs and higher lows" : "Lower highs and lower lows");
  const base = candles.slice(-21, -1);
  if (s > 0 ? close > hiOf(base) : close < loOf(base)) { st += 4; conf.push("Break of 20-bar structure"); }
  const bb = ind.bollinger;
  const ext = bb.context === "upper-band" ? 1 : bb.context === "lower-band" ? -1 : 0;
  if (bb.context === "inside") st += bb.direction === want.dir ? 3 : 2;
  else if (bb.context === "breakout") { if ((close > bb.upper ? 1 : -1) * s > 0) st += 3; else warnings.push("Bollinger breakout against the setup"); }
  else if (ext * s < 0) st += 2;
  else { st += 1; warnings.push("Price is at the band in the setup direction (chasing risk)"); }
    let penalty = 0;
  const stretch = Math.abs(close - ind.ema20) / atr;if (stretch <= 1.5) st += 2;
  if (stretch > 1.8) penalty += 4;
  else {
    warnings.push(`Price is ${stretch.toFixed(1)} ATR away from EMA20`);
    if (stretch > 2) critical = critical ?? "Price is overextended from EMA20 (chasing risk)";
  }

  // ---- 4. Liquidity / support-resistance (10) ----
  let lq = 0;
  if (!ahead) { lq += 5; conf.push("No nearby opposing level ahead"); }
  else {
    const room = Math.abs(ahead.price - close) / atr;
    lq += room >= 3 ? 5 : room >= 2 ? 3 : room >= 1 ? 1 : 0;
    if (room < 1) warnings.push("Opposing level is less than 1 ATR away");
    else if (room >= 3) conf.push(`${room.toFixed(1)} ATR of room to the next level`);
  }
  if (behind) {
    const d = Math.abs(close - behind.price) / atr;
    lq += d <= 1.5 ? 3 : d <= 3 ? 2 : 0;
    if (behind.touches >= 2) lq += 2;
  }

  // ---- 5. Volume + momentum (15) ----
  let vm = 0;
  const r = s > 0 ? ind.rsi.value : 100 - ind.rsi.value;
  if (r >= 50 && r <= 70) vm += 4;
  else if ((r >= 40 && r < 50) || (r > 70 && r <= 75)) vm += 2;
  else if (r > 72) {
    warnings.push(`RSI ${ind.rsi.value.toFixed(0)} is stretched for a ${side}`);
    critical = critical ?? `RSI ${ind.rsi.value.toFixed(0)} is overextended for a ${side}`;
  }
  if (ind.macd.histogram * s > 0) vm += ind.macd.histogramState === "expanding" ? 4 : 2;
  else conflicts.push("MACD histogram against the setup");
  if (ind.macd.crossover === want.bias) conf.push("Fresh MACD crossover in the setup direction");
  const kAbove = adv.stochRsi.k > adv.stochRsi.d;
  const stochExt = s > 0 ? adv.stochRsi.zone === "overbought" : adv.stochRsi.zone === "oversold";
  if (s > 0 ? kAbove : !kAbove) vm += stochExt ? 1 : 2;
  if (adv.obv.slope === want.dir) vm += 2;
  if (adv.obv.divergence === want.opp) conflicts.push(`OBV ${adv.obv.divergence} divergence against the setup`);
  else vm += 1;
  const vols = candles.slice(-21, -1).map((x) => x.volume);
  const avgV = vols.reduce((a, b) => a + b, 0) / vols.length;
  const vr = avgV > 0 ? k.volume / avgV : 0;
  vm += vr >= 1.2 ? 2 : vr >= 0.8 ? 1 : 0;
  if (vr >= 1.5) conf.push(`Volume ${vr.toFixed(1)}x the 20-bar average`);

  // ---- 6. Derivatives + order book (10) ----
  let dd = 0;
  const dv = input.derivatives ?? null;
  const f = dv?.fundingRate;
  if (num(f)) {
    const c = f * s;
    dd += c <= 0.0001 ? 3 : c <= 0.0003 ? 2 : 0;
    if (c > 0.0003) warnings.push("Funding is crowded on the setup side");
  } else unavailable.push("fundingRate");
  const oi = dv?.oiChangePct;
  if (num(oi)) {
    const moveAligned = (close - closeAgo(14)) * s > 0;
    if (oi > 0 && moveAligned) { dd += 2; conf.push("Open interest rising with the move"); }
    else if (oi < 0 && moveAligned) dd += 1;
  } else unavailable.push("openInterest");
  const ls = dv?.longShortRatio;
  if (num(ls) && ls > 0) {
    const crowd = s > 0 ? ls : 1 / ls;
    dd += crowd <= 1.5 ? 2 : crowd <= 2.5 ? 1 : 0;
    if (crowd > 2.5) warnings.push("Positioning is crowded on the setup side");
  } else unavailable.push("longShortRatio");
  const bi = dv?.bookImbalance;
  if (num(bi)) { const a = bi * s; dd += a >= 0.2 ? 3 : a >= 0.05 ? 2 : a >= -0.05 ? 1 : 0; }
else unavailable.push("orderBook");
  const tt = dv?.topTraderRatio;
  if (num(tt) && tt > 0) {
    const a = s > 0 ? tt : 1 / tt;
    if (a >= 1.1) { dd += 1; conf.push("Top traders positioned with the setup"); }
    else if (a <= 0.9) { dd -= 1; warnings.push("Top traders positioned against the setup"); }
  }
  const tk = dv?.takerBuySellRatio;
  if (num(tk) && tk > 0) {
    const a = s > 0 ? tk : 1 / tk;
    if (a >= 1.1) { dd += 1; conf.push("Aggressive taker flow supports the setup"); }
    else if (a <= 0.9) { dd -= 1; warnings.push("Taker flow is against the setup"); }
  }

  // ---- 7. News + fundamentals (5) ----
  let nf = 0;
  const nw = input.news;
  if (!nw) unavailable.push("news");
  else if (nw.highImpactSoon) critical = "High-impact news event imminent";
  else {
    const a = nw.sentiment * s;
    nf = a >= 0.3 ? 5 : a >= 0.1 ? 4 : a >= -0.1 ? 3 : a >= -0.3 ? 1 : 0;
    if (a < -0.3) conflicts.push("News sentiment against the setup");
  }

  // ---- 8. Risk + execution (15) ----
  let rk = 0;
  const stopDist = 2 * atr;
  const rr = ahead ? Math.abs(ahead.price - close) / stopDist : null;
  rk += rr === null ? 4 : rr >= 2 ? 6 : rr >= 1.5 ? 4 : rr >= 1 ? 2 : 0;
  if (rr !== null && rr < 1) warnings.push(`Only ${rr.toFixed(1)}R of room to the next level`);
  const stopPct = (stopDist / close) * 100;
  rk += stopPct <= 3 ? 3 : stopPct <= 5 ? 2 : 0;
  rk += behind && Math.abs(close - behind.price) <= 3 * atr ? 3 : 1;
  const range = k.high - k.low;
  if (range > 4 * atr) critical = critical ?? "Extreme volatility spike on the last candle";
  if (range <= 2.5 * atr) rk += 3; else warnings.push("Last candle is over-extended");

  const score: SetupScore = {
    total: 0,
    marketContext: clamp(mc, SCORE_MAX.marketContext), trendMTF: clamp(tr, SCORE_MAX.trendMTF),
    structure: clamp(st, SCORE_MAX.structure), liquiditySR: clamp(lq, SCORE_MAX.liquiditySR),
    volumeMomentum: clamp(vm, SCORE_MAX.volumeMomentum), derivativesOrderbook: clamp(dd, SCORE_MAX.derivativesOrderbook),
    newsFundamentals: clamp(nf, SCORE_MAX.newsFundamentals), riskExecution: clamp(rk, SCORE_MAX.riskExecution),
  };
  const rawTotal =
    score.marketContext + score.trendMTF + score.structure + score.liquiditySR +
    score.volumeMomentum + score.derivativesOrderbook + score.newsFundamentals + score.riskExecution;
  const lostMax =
    (unavailable.includes("fundingRate") ? 3 : 0) + (unavailable.includes("openInterest") ? 2 : 0) +
    (unavailable.includes("longShortRatio") ? 2 : 0) + (unavailable.includes("orderBook") ? 3 : 0) +
    (unavailable.includes("news") ? 5 : 0);
  score.total = Math.round((rawTotal * 100) / (100 - lostMax));
  return { side, score, confirmations: conf, conflicts, warnings, unavailable, criticalFailure: critical };
                            }
