import { describe, expect, it } from "vitest";
import type { Candle } from "../shared/market.js";
import { scoreSetup } from "../shared/scoring.js";
import { buildSignal, hasRealDerivatives, PROFILES, resolveProfile, shadowScore, STRATEGY_VERSION } from "../server/engine/signalBuilder.js";
import type { BuildSignalInput } from "../server/engine/signalBuilder.js";

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
const base = (candles: Candle[]): BuildSignalInput => ({
  symbol: "btcusdt", exchange: "okx", marketType: "swap",
  timeframe: { primary: "1H", confirmation: "4H", execution: "5m" }, candles, change24hPct: 1.2,
});
const NOW = (c: Candle[]) => (c[c.length - 1]?.timestamp ?? T0) + HOUR;
const CORE4 = { core4: true, core: "ema,rsi,smc,liq", smc: "soft", liq: "soft" } as const;

describe("strategy profiles", () => {
  it("resolve with a safe fallback to A", () => {
    expect(resolveProfile(undefined).id).toBe("A");
    expect(resolveProfile("b").id).toBe("B");
    expect(resolveProfile("c").id).toBe("C");
    expect(resolveProfile("zzz").id).toBe("A");
  });
  it("C is not backtestable (no historical derivatives data); A and B are", () => {
    expect(PROFILES.A.backtestable).toBe(true);
    expect(PROFILES.B.backtestable).toBe(true);
    expect(PROFILES.C.backtestable).toBe(false);
  });
  it("profile A changes nothing: identical signal with and without its config", () => {
    const c = series(250, 0.25);
    const a = buildSignal(base(c), { now: NOW(c), id: "x" });
    const b = buildSignal(base(c), { now: NOW(c), id: "x", config: PROFILES.A.config });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.strategy?.version).toBe(STRATEGY_VERSION);
  });
  it("profile B records its own version and uses the FULL scoring", () => {
    const c = series(250, 0.25);
    const s = buildSignal(base(c), { now: NOW(c), id: "x", config: PROFILES.B.config });
    expect(s.strategy?.version).toBe("full-v1");
    expect(s.strategy?.scoring).toBe("FULL");
  });
  it("profile C never trades without real derivatives", () => {
    const c = series(250, 0.25);
    const s = buildSignal(base(c), { now: NOW(c), id: "x", config: PROFILES.C.config });
    expect(["WAIT", "NO_TRADE"]).toContain(s.direction);
    expect(s.strategy?.version).toBe("full-deriv-v1");
  });
  it("hasRealDerivatives needs all four fields to be real numbers", () => {
    expect(hasRealDerivatives(null)).toBe(false);
    expect(hasRealDerivatives({ fundingRate: 0.01, oiChangePct: 1, longShortRatio: 1.1, bookImbalance: null })).toBe(false);
    expect(hasRealDerivatives({ fundingRate: 0.01, oiChangePct: 1, longShortRatio: 1.1, bookImbalance: 0.2 })).toBe(true);
    expect(hasRealDerivatives({ fundingRate: Number.NaN, oiChangePct: 1, longShortRatio: 1.1, bookImbalance: 0.2 })).toBe(false);
  });
});

describe("shadow score (experimental, never decides)", () => {
  it("is absent unless SHADOW_SCORE=true", () => {
    const c = series(250, 0.25);
    const s = buildSignal(base(c), { now: NOW(c), id: "x" });
    expect("shadow" in s).toBe(false);
  });
  it("counts missing liquidation data as 0, not the neutral midpoint", () => {
    const c = series(250, 0.05);
    const scored = scoreSetup({ candles: c, gates: CORE4, now: NOW(c) });
    const sh = shadowScore(scored, { ...CORE4, adxMin: 0, htfFilter: false, requireCandle: false, candleVolMin: 1, requireFib: false });
    expect(sh?.missing).toContain("liquidation");
    expect(sh?.total).toBe(scored.score.total - scored.score.liquiditySR);
    expect(sh?.liveTotal).toBe(scored.score.total);
  });
  it("does not change the live signal when enabled", () => {
    const c = series(250, 0.25);
    const off = buildSignal(base(c), { now: NOW(c), id: "x" });
    process.env.SHADOW_SCORE = "true";
    try {
      const on = buildSignal(base(c), { now: NOW(c), id: "x" });
      const { shadow: _shadow, ...rest } = on as typeof on & { shadow?: unknown };
      expect(JSON.stringify(rest)).toBe(JSON.stringify(off));
    } finally {
      delete process.env.SHADOW_SCORE;
    }
  });
});
