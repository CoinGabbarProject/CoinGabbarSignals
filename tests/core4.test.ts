import { describe, expect, it } from "vitest";
import type { Candle } from "../shared/market.js";
import { scoreSetup } from "../shared/scoring.js";
import type { SetupGates } from "../shared/scoring.js";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);
function rng(seed: number) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }
function series(n: number, drift: number, seed = 7, start = 100, noise = 0.6): Candle[] {
  const r = rng(seed); let price = start;
  return Array.from({ length: n }, (_, i) => {
    const open = price; price = Math.max(1, open + drift + (r() - 0.5) * noise);
    return { timestamp: T0 + i * HOUR, open, high: Math.max(open, price) + r() * 0.3, low: Math.min(open, price) - r() * 0.3, close: price, volume: 1000 + r() * 500 };
  });
}
const flat = (n: number): Candle[] => Array.from({ length: n }, (_, i) => ({ timestamp: T0 + i * HOUR, open: 100, high: 101, low: 99, close: 100, volume: 1000 }));
const jumped = (): Candle[] => {
  const base = series(120, 0.02, 3, 100, 0.4);
  const last = base[base.length - 1] as Candle;
  return [...base, { timestamp: last.timestamp + HOUR, open: last.close, high: last.close + 11, low: last.close, close: last.close + 10, volume: 3000 }];
};

// The production default: CORE4=true, CORE_INDICATORS=ema,rsi,smc,liq, SMC_MODE=soft, LIQ_MODE=soft.
const CORE4: Partial<SetupGates> = { core4: true, core: "ema,rsi,smc,liq", smc: "soft", liq: "soft" };
const NOW = T0 + 400 * HOUR;
const run = (candles: Candle[], gates: Partial<SetupGates> = CORE4) => scoreSetup({ candles, gates, now: NOW });

describe("CORE4 scoring path (production default)", () => {
  it("direction comes only from EMA20 vs EMA50", () => {
    expect(run(series(250, 0.05)).side).toBe("LONG");
    expect(run(series(250, -0.05, 8, 200)).side).toBe("SHORT");
    const n = run(flat(120));
    expect(n.side).toBe("NEUTRAL");
    expect(n.score.total).toBe(0);
  });
  it("ADX, higher-timeframe, candle and Fib gates are NOT applied (full engine does apply them)", () => {
    const c = series(250, 0.05);
    const strict = { ...CORE4, adxMin: 100, htfFilter: true, requireCandle: true, requireFib: true };
    expect(JSON.stringify(run(c, strict))).toBe(JSON.stringify(run(c)));
    const full = run(c, { adxMin: 100, htfFilter: false, requireCandle: false, candleVolMin: 1, requireFib: false, core4: false });
    expect(full.criticalFailure).toMatch(/ADX/);
  });
  it("price far from EMA20 is a hard failure that overrides the score", () => {
    const r = run(jumped());
    expect(r.side).toBe("LONG");
    expect(r.criticalFailure).toMatch(/overextended/i);
  });
  it("component scores respect their caps and the total stays within 0..100", () => {
    for (const c of [series(250, 0.05), series(250, -0.05, 8, 200), series(250, 0.25), jumped()]) {
      const s = run(c).score;
      expect(s.trendMTF).toBeLessThanOrEqual(30);
      expect(s.volumeMomentum).toBeLessThanOrEqual(20);
      expect(s.structure).toBeLessThanOrEqual(30);
      expect(s.liquiditySR).toBeLessThanOrEqual(20);
      expect(s.total).toBeGreaterThanOrEqual(0);
      expect(s.total).toBeLessThanOrEqual(100);
    }
  });
  it("CORE_INDICATORS selects the components that count", () => {
    const s = run(series(250, 0.05), { ...CORE4, core: "ema,rsi" }).score;
    expect(s.structure).toBe(0);
    expect(s.liquiditySR).toBe(0);
    expect(s.trendMTF).toBeGreaterThan(0);
  });
  it("is deterministic for identical input and `now`", () => {
    const c = series(250, 0.05);
    expect(JSON.stringify(run(c))).toBe(JSON.stringify(run(c)));
  });
});

// These pin the CURRENT behaviour so any change is deliberate. They describe limitations, not desired behaviour.
// When they are fixed, bump STRATEGY_VERSION and update these tests in the same commit.
describe("CORE4 known limitations (current behaviour)", () => {
  it("missing liquidation data scores the neutral midpoint (10 of 20) instead of 0", () => {
    expect(run(series(250, 0.05)).score.liquiditySR).toBe(10);
  });
  it("missing data is not reported: `unavailable` stays empty in the CORE4 path", () => {
    expect(run(series(250, 0.05)).unavailable).toEqual([]);
  });
  it("SMC_MODE=off is ignored while CORE_INDICATORS contains smc", () => {
    const c = series(250, 0.05);
    expect(JSON.stringify(run(c, { ...CORE4, smc: "off", liq: "off" }))).toBe(JSON.stringify(run(c)));
  });
});
