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
