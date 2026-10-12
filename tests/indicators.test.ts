import { describe, expect, it } from "vitest";
import type { Candle } from "../shared/market.js";
import {
  adxSeries, atrSeries, calcADX, calcBollinger, calcIndicators, calcMACD,
  emaSeries, rsiSeries, smaSeries,
} from "../shared/indicators.js";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);
const flat = (n: number, price = 100, range = 2): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ timestamp: T0 + i * HOUR, open: price, high: price + range / 2, low: price - range / 2, close: price, volume: 1000 }));
const trend = (n: number, step: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const c = 100 + i * step;
    return { timestamp: T0 + i * HOUR, open: c - step / 2, high: c + 0.4, low: c - step - 0.4, close: c, volume: 1000 };
  });
const firstValid = (a: number[]): number => a.findIndex((v) => Number.isFinite(v));

// Expected RSI values come from an independent Python implementation of Wilder's RSI.
const REF = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13];

describe("moving averages", () => {
  it("SMA matches hand calculation and has NaN warm-up", () => {
    const s = smaSeries([1, 2, 3, 4, 5], 3);
    expect(s.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(s.slice(2)).toEqual([2, 3, 4]);
  });
  it("EMA is seeded with the SMA and then recursive (k = 2/(n+1))", () => {
    const e = emaSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
    expect(Number.isNaN(e[0])).toBe(true);
    expect(Number.isNaN(e[1])).toBe(true);
    expect(e.slice(2)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it("returns all NaN when there is not enough data", () => {
    expect(smaSeries([1, 2], 3).every(Number.isNaN)).toBe(true);
    expect(emaSeries([1, 2], 3).every(Number.isNaN)).toBe(true);
  });
});

describe("RSI (Wilder 14)", () => {
  const r = rsiSeries(REF, 14);
  it("first value appears at index 14 (warm-up = period)", () => { expect(firstValid(r)).toBe(14); });
  it("matches independent reference values", () => {
    expect(r[14]).toBeCloseTo(70.4641, 3);
    expect(r[15]).toBeCloseTo(66.2496, 3);
    expect(r[16]).toBeCloseTo(66.4809, 3);
    expect(r[32]).toBeCloseTo(37.7888, 3);
  });
  it("is 100 on a rising series and 50 on a flat series", () => {
    expect(rsiSeries(Array.from({ length: 30 }, (_, i) => 100 + i), 14).at(-1)).toBe(100);
    expect(rsiSeries(Array.from({ length: 30 }, () => 100), 14).at(-1)).toBe(50);
  });
  it("stays within 0..100", () => {
    for (const v of r) if (Number.isFinite(v)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
  });
});

describe("ATR (Wilder 14)", () => {
  it("equals the constant true range on gap-free candles", () => {
    const a = atrSeries(flat(40, 100, 2), 14);
    expect(firstValid(a)).toBe(14);
    expect(a.at(-1)).toBeCloseTo(2, 10);
  });
});

describe("ADX / DI", () => {
  it("warm-up: first ADX at index 2*period-1", () => {
    expect(firstValid(adxSeries(trend(80, 1), 14).adx)).toBe(27);
  });
  it("uptrend: +DI > -DI, strong ADX, bullish bias", () => {
    const a = calcADX(trend(80, 1));
    expect(a.plusDI).toBeGreaterThan(a.minusDI);
    expect(a.adx).toBeGreaterThan(25);
    expect(a.bias).toBe("bullish");
  });
  it("downtrend is bearish", () => { expect(calcADX(trend(80, -1)).bias).toBe("bearish"); });
  it("too few candles gives NaN, not a fabricated number", () => { expect(Number.isNaN(calcADX(trend(20, 1)).adx)).toBe(true); });
});

describe("MACD and Bollinger", () => {
  it("MACD is zero on a constant series", () => {
    const m = calcMACD(flat(80));
    expect(m.macd).toBeCloseTo(0, 10);
    expect(m.histogram).toBeCloseTo(0, 10);
  });
  it("MACD is positive in an uptrend", () => { expect(calcMACD(trend(80, 1)).macd).toBeGreaterThan(0); });
  it("Bollinger bandwidth is zero on a constant series, wider with noise", () => {
    expect(calcBollinger(flat(40)).bandwidth).toBe(0);
    expect(calcBollinger(trend(40, 1)).bandwidth).toBeGreaterThan(0);
  });
});

describe("calcIndicators guards", () => {
  it("returns null with fewer than 60 candles", () => { expect(calcIndicators(flat(59))).toBeNull(); });
  it("returns null when any candle has a NaN value", () => {
    const c = flat(80); c[40] = { ...(c[40] as Candle), close: NaN };
    expect(calcIndicators(c)).toBeNull();
  });
  it("SMA200 is null until 200 candles exist", () => {
    expect(calcIndicators(flat(150))?.sma200).toBeNull();
    expect(calcIndicators(flat(250))?.sma200).toBeCloseTo(100, 10);
  });
});
