import type { Candle } from "./market.js";
export type Direction = "up"|"down"|"flat";
export interface IndicatorResult<T=number> { value:T; slope:Direction; direction:Direction; relationship?:string; }
export interface RSIResult extends IndicatorResult { zone:"oversold"|"neutral"|"overbought"; momentum:"weakening"|"neutral"|"strengthening"; }
export interface MACDResult { macd:number; signal:number; histogram:number; crossover:"bullish"|"bearish"|"none"; histogramState:"expanding"|"contracting"|"flat"; zeroLine:"above"|"below"; momentum:Direction; }
export interface BollingerResult { middle:number; upper:number; lower:number; bandwidth:number; direction:Direction; context:"inside"|"upper-band"|"lower-band"|"breakout"; }
export interface ATRResult extends IndicatorResult { }
export interface VWAPResult extends IndicatorResult { }
export interface IndicatorSnapshot { rsi:RSIResult; macd:MACDResult; bollinger:BollingerResult; atr:ATRResult; vwap:VWAPResult; ema20:number; ema50:number; sma200:number|null; }
export const MIN_CANDLES = 60;

// ---- helpers ----
const at = (a:number[], i:number):number => { const v = a[i < 0 ? a.length + i : i]; return v === undefined ? NaN : v; };
const dirOf = (now:number, prev:number, eps = 1e-9):Direction => !Number.isFinite(now) || !Number.isFinite(prev) ? "flat" : now > prev + eps ? "up" : now < prev - eps ? "down" : "flat";
const blank = (n:number):number[] => new Array<number>(n).fill(NaN);
const closesOf = (c:Candle[]):number[] => c.map((x) => x.close);

// ---- moving averages ----
export function smaSeries(values:number[], period:number):number[] {
  const out = blank(values.length);
  if (period < 1 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += at(values, i);
    if (i >= period) sum -= at(values, i - period);
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function emaSeries(values:number[], period:number):number[] {
  const out = blank(values.length);
  const start = values.findIndex((v) => Number.isFinite(v));
  if (period < 1 || start < 0 || values.length - start < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = start; i < start + period; i++) seed += at(values, i);
  out[start + period - 1] = seed / period;
  for (let i = start + period; i < values.length; i++) out[i] = at(values, i) * k + at(out, i - 1) * (1 - k);
  return out;
}

// ---- RSI (Wilder) ----
const rsiFrom = (gain:number, loss:number):number => loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);

export function rsiSeries(closes:number[], period = 14):number[] {
  const out = blank(closes.length);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = at(closes, i) - at(closes, i - 1); gain += Math.max(d, 0); loss += Math.max(-d, 0); }
  gain /= period; loss /= period;
  out[period] = rsiFrom(gain, loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = at(closes, i) - at(closes, i - 1);
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = rsiFrom(gain, loss);
  }
  return out;
}

export function calcRSI(candles:Candle[], period = 14):RSIResult {
  const s = rsiSeries(closesOf(candles), period);
  const value = at(s, -1), prev = at(s, -2), back = at(s, -4);
  const d = value - back;
  return {
    value, slope: dirOf(value, prev), direction: dirOf(value, prev),
    zone: value >= 70 ? "overbought" : value <= 30 ? "oversold" : "neutral",
    momentum: d > 2 ? "strengthening" : d < -2 ? "weakening" : "neutral",
  };
}

// ---- MACD (12, 26, 9) ----
export function calcMACD(candles:Candle[], fast = 12, slow = 26, signalP = 9):MACDResult {
  const c = closesOf(candles);
  const f = emaSeries(c, fast), s = emaSeries(c, slow);
  const line = c.map((_, i) => at(f, i) - at(s, i));
  const sig = emaSeries(line, signalP);
  const hist = line.map((v, i) => v - at(sig, i));
  const h = at(hist, -1), hp = at(hist, -2);
  const crossover = hp <= 0 && h > 0 ? "bullish" : hp >= 0 && h < 0 ? "bearish" : "none";
  const grow = Math.abs(h) - Math.abs(hp);
  const eps = Math.abs(hp) * 0.01 + 1e-12;
  return {
    macd: at(line, -1), signal: at(sig, -1), histogram: h, crossover,
    histogramState: grow > eps ? "expanding" : grow < -eps ? "contracting" : "flat",
    zeroLine: at(line, -1) >= 0 ? "above" : "below",
    momentum: dirOf(h, hp),
  };
}

// ---- Bollinger Bands (20, 2) ----
export function calcBollinger(candles:Candle[], period = 20, mult = 2):BollingerResult {
  const c = closesOf(candles);
  const mid = smaSeries(c, period);
  const m = at(mid, -1);
  const win = c.slice(-period);
  const sd = Math.sqrt(win.reduce((a, v) => a + (v - m) ** 2, 0) / period);
  const upper = m + mult * sd, lower = m - mult * sd;
  const close = at(c, -1);
  const pctB = upper === lower ? 0.5 : (close - lower) / (upper - lower);
  const context = close > upper || close < lower ? "breakout" : pctB >= 0.85 ? "upper-band" : pctB <= 0.15 ? "lower-band" : "inside";
  return { middle: m, upper, lower, bandwidth: m === 0 ? 0 : (upper - lower) / m, direction: dirOf(m, at(mid, -2)), context };
}

// ---- ATR (Wilder, 14) ----
export function atrSeries(candles:Candle[], period = 14):number[] {
  const out = blank(candles.length);
  if (candles.length <= period) return out;
  const tr = candles.map((k, i) => {
    const pc = i === 0 ? k.close : (candles[i - 1]?.close ?? k.close);
    return Math.max(k.high - k.low, Math.abs(k.high - pc), Math.abs(k.low - pc));
  });
  let a = 0;
  for (let i = 1; i <= period; i++) a += at(tr, i);
  a /= period;
  out[period] = a;
  for (let i = period + 1; i < candles.length; i++) { a = (a * (period - 1) + at(tr, i)) / period; out[i] = a; }
  return out;
}

export function calcATR(candles:Candle[], period = 14):ATRResult {
  const s = atrSeries(candles, period);
  const value = at(s, -1), prev = at(s, -2);
  return { value, slope: dirOf(value, prev), direction: dirOf(value, prev) };
}

// ---- VWAP (resets every UTC day) ----
export function vwapSeries(candles:Candle[]):number[] {
  const out = blank(candles.length);
  let pv = 0, vol = 0, day = -1;
  candles.forEach((k, i) => {
    const d = Math.floor(k.timestamp / 86_400_000);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    pv += ((k.high + k.low + k.close) / 3) * k.volume;
    vol += k.volume;
    out[i] = vol > 0 ? pv / vol : k.close;
  });
  return out;
}

export function calcVWAP(candles:Candle[]):VWAPResult {
  const s = vwapSeries(candles);
  const value = at(s, -1), close = candles[candles.length - 1]?.close ?? NaN;
  const rel = close > value ? "above" : close < value ? "below" : "at";
  return { value, slope: dirOf(value, at(s, -2)), direction: dirOf(value, at(s, -2)), relationship: rel };
}

// ================= STEP 2: advanced indicators =================
export interface ADXResult { adx:number; plusDI:number; minusDI:number; strength:"none"|"weak"|"strong"|"very-strong"; bias:"bullish"|"bearish"|"neutral"; slope:Direction; }
export interface StochRSIResult { k:number; d:number; zone:"oversold"|"neutral"|"overbought"; crossover:"bullish"|"bearish"|"none"; }
export interface OBVResult { value:number; slope:Direction; divergence:"bullish"|"bearish"|"none"; }
export interface SRLevel { price:number; touches:number; }
export interface SupportResistance { supports:SRLevel[]; resistances:SRLevel[]; nearestSupport:SRLevel|null; nearestResistance:SRLevel|null; }
export interface AdvancedSnapshot { adx:ADXResult; stochRsi:StochRSIResult; obv:OBVResult; levels:SupportResistance; }

// SMA that skips the leading NaN warm-up values
const smaValid = (v:number[], p:number):number[] => {
  const s = v.findIndex((x) => Number.isFinite(x));
  return s < 0 ? blank(v.length) : [...blank(s), ...smaSeries(v.slice(s), p)];
};

// ---- ADX / +DI / -DI (Wilder, 14) ----
export function adxSeries(candles:Candle[], period = 14) {
  const n = candles.length;
  const adx = blank(n), plus = blank(n), minus = blank(n), dx = blank(n);
  if (n < 2 * period + 1) return { adx, plus, minus };
  let sTR = 0, sP = 0, sM = 0;
  for (let i = 1; i < n; i++) {
    const k = candles[i], p = candles[i - 1];
    if (!k || !p) continue;
    const up = k.high - p.high, dn = p.low - k.low;
    const pdm = up > dn && up > 0 ? up : 0;
    const mdm = dn > up && dn > 0 ? dn : 0;
    const tr = Math.max(k.high - k.low, Math.abs(k.high - p.close), Math.abs(k.low - p.close));
    if (i <= period) { sTR += tr; sP += pdm; sM += mdm; }
    else { sTR = sTR - sTR / period + tr; sP = sP - sP / period + pdm; sM = sM - sM / period + mdm; }
    if (i >= period) {
      const pdi = sTR === 0 ? 0 : (100 * sP) / sTR, mdi = sTR === 0 ? 0 : (100 * sM) / sTR;
      plus[i] = pdi; minus[i] = mdi;
      dx[i] = pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
    }
  }
  let a = 0;
  for (let i = period; i < 2 * period; i++) a += at(dx, i);
  a /= period;
  adx[2 * period - 1] = a;
  for (let i = 2 * period; i < n; i++) { a = (a * (period - 1) + at(dx, i)) / period; adx[i] = a; }
  return { adx, plus, minus };
}

export function calcADX(candles:Candle[], period = 14):ADXResult {
  const { adx, plus, minus } = adxSeries(candles, period);
  const v = at(adx, -1), p = at(plus, -1), m = at(minus, -1);
  return {
    adx: v, plusDI: p, minusDI: m,
    strength: v >= 40 ? "very-strong" : v >= 25 ? "strong" : v >= 20 ? "weak" : "none",
    bias: p > m ? "bullish" : p < m ? "bearish" : "neutral",
    slope: dirOf(v, at(adx, -2), 0.05),
  };
}

// ---- Stochastic RSI (14, 14, 3, 3) ----
export function calcStochRSI(candles:Candle[], rsiP = 14, stochP = 14, kP = 3, dP = 3):StochRSIResult {
  const r = rsiSeries(closesOf(candles), rsiP);
  const st = blank(r.length);
  for (let i = rsiP + stochP - 1; i < r.length; i++) {
    const w = r.slice(i - stochP + 1, i + 1);
    const hi = Math.max(...w), lo = Math.min(...w);
    st[i] = hi === lo ? (at(r, i) >= 70 ? 100 : at(r, i) <= 30 ? 0 : 50) : (100 * (at(r, i) - lo)) / (hi - lo);
  }
  const k = smaValid(st, kP), d = smaValid(k, dP);
  const kv = at(k, -1), dv = at(d, -1), kp = at(k, -2), dp = at(d, -2);
  return {
    k: kv, d: dv,
    zone: kv >= 80 ? "overbought" : kv <= 20 ? "oversold" : "neutral",
    crossover: kp <= dp && kv > dv ? "bullish" : kp >= dp && kv < dv ? "bearish" : "none",
  };
}

// ---- OBV + divergence (14-bar lookback) ----
export function obvSeries(candles:Candle[]):number[] {
  const out = blank(candles.length);
  let obv = 0;
  candles.forEach((k, i) => {
    const pc = i === 0 ? k.close : (candles[i - 1]?.close ?? k.close);
    obv += k.close > pc ? k.volume : k.close < pc ? -k.volume : 0;
    out[i] = obv;
  });
  return out;
}

export function calcOBV(candles:Candle[], lookback = 14):OBVResult {
  const s = obvSeries(candles);
  const c = closesOf(candles);
  const dObv = at(s, -1) - at(s, -1 - lookback);
  const dPx = at(c, -1) - at(c, -1 - lookback);
  return {
    value: at(s, -1), slope: dirOf(dObv, 0),
    divergence: dPx > 0 && dObv < 0 ? "bearish" : dPx < 0 && dObv > 0 ? "bullish" : "none",
  };
}

// ---- Support / Resistance (swing pivots, ATR-clustered) ----
export function calcLevels(candles:Candle[], left = 3, right = 3, lookback = 200):SupportResistance {
  const c = candles.slice(-lookback);
  const empty:SupportResistance = { supports: [], resistances: [], nearestSupport: null, nearestResistance: null };
  const last = c[c.length - 1];
  if (!last || c.length < left + right + 1) return empty;
  const close = last.close;
  const atr = at(atrSeries(c), -1);
  const tol = Number.isFinite(atr) && atr > 0 ? atr * 0.5 : close * 0.003;
  const pivots:number[] = [];
  for (let i = left; i < c.length - right; i++) {
    const k = c[i];
    if (!k) continue;
    let isH = true, isL = true;
    for (let j = i - left; j <= i + right; j++) {
      const o = c[j];
      if (j === i || !o) continue;
      if (o.high >= k.high) isH = false;
      if (o.low <= k.low) isL = false;
    }
    if (isH) pivots.push(k.high);
    if (isL) pivots.push(k.low);
  }
  const levels:SRLevel[] = [];
  let grp:number[] = [];
  const flush = () => { if (grp.length) { levels.push({ price: grp.reduce((a, b) => a + b, 0) / grp.length, touches: grp.length }); grp = []; } };
  for (const p of [...pivots].sort((a, b) => a - b)) {
    const first = grp[0];
    if (first !== undefined && p - first > tol) flush();
    grp.push(p);
  }
  flush();
  const supports = levels.filter((l) => l.price < close).sort((a, b) => b.price - a.price).slice(0, 3);
  const resistances = levels.filter((l) => l.price > close).sort((a, b) => a.price - b.price).slice(0, 3);
  return { supports, resistances, nearestSupport: supports[0] ?? null, nearestResistance: resistances[0] ?? null };
}

export function calcAdvanced(candles:Candle[]):AdvancedSnapshot | null {
  if (candles.length < MIN_CANDLES) return null;
  if (candles.some((k) => ![k.open, k.high, k.low, k.close, k.volume].every(Number.isFinite))) return null;
  return { adx: calcADX(candles), stochRsi: calcStochRSI(candles), obv: calcOBV(candles), levels: calcLevels(candles) };
}

// ---- all-in-one (used by scoring in Step 3) ----
export function calcIndicators(candles:Candle[]):IndicatorSnapshot | null {
  if (candles.length < MIN_CANDLES) return null;
  if (candles.some((k) => ![k.open, k.high, k.low, k.close, k.volume].every(Number.isFinite))) return null;
  const c = closesOf(candles);
  const s200 = at(smaSeries(c, 200), -1);
  return {
    rsi: calcRSI(candles), macd: calcMACD(candles), bollinger: calcBollinger(candles),
    atr: calcATR(candles), vwap: calcVWAP(candles),
    ema20: at(emaSeries(c, 20), -1), ema50: at(emaSeries(c, 50), -1),
    sma200: Number.isFinite(s200) ? s200 : null,
  };
}
