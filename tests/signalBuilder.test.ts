import { describe, expect, it } from "vitest";
import type { Candle } from "../shared/market.js";
import { buildSignal, planTrade, DEFAULT_CONFIG } from "../server/engine/signalBuilder.js";
import type { BuildSignalInput } from "../server/engine/signalBuilder.js";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);

// deterministic pseudo-random so tests never flake
function rng(seed: number) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }

function series(n: number, drift: number, seed = 7, start = 100, noise = 0.6): Candle[] {
  const r = rng(seed);
  let price = start;
  return Array.from({ length: n }, (_, i) => {
    const open = price;
    price = Math.max(1, open + drift + (r() - 0.5) * noise);
    const high = Math.max(open, price) + r() * 0.3, low = Math.min(open, price) - r() * 0.3;
    return { timestamp: T0 + i * HOUR, open, high, low, close: price, volume: 1000 + r() * 500 };
  });
}

const base = (candles: Candle[]): BuildSignalInput => ({
  symbol: "btcusdt", exchange: "binance", marketType: "spot",
  timeframe: { primary: "1H", confirmation: "4H", execution: "15m" },
  candles, change24hPct: 1.2,
});
const NOW = (c: Candle[]) => (c[c.length - 1]?.timestamp ?? T0) + HOUR;

describe("planTrade", () => {
  const cfg = DEFAULT_CONFIG;
  it("LONG: stop below entry, targets above, increasing, R:R consistent", () => {
    const r = planTrade(1, 100, 2, null, null, cfg);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.plan;
    expect(p.stop.price).toBe(96);
expect(p.targets).toEqual([106, 110, 116]);
    expect(p.rr).toEqual({ tp1: 1.5, tp2: 2.5, tp3: 4, weighted: 2.3 });
    expect(p.entry.min).toBeLessThan(p.entry.ideal);
    expect(p.entry.max).toBeGreaterThan(p.entry.ideal);
  });
  it("SHORT mirrors LONG", () => {
    const r = planTrade(-1, 100, 2, null, null, cfg);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.stop.price).toBe(104);
expect(r.plan.targets).toEqual([94, 90, 84]);
    expect(r.plan.entry.min).toBeLessThan(r.plan.entry.ideal);
  });
  it("uses structural stop when it is 1.5-3 ATR away", () => {
    const r = planTrade(1, 100, 2, { price: 96.5, touches: 3 }, null, cfg);
    expect(r.ok && r.plan.stop.method).toBe("STRUCTURE_ATR");
    expect(r.ok && r.plan.stop.price).toBe(96); // 96.5 - 0.25*2
  });
  it("falls back to ATR stop when support is too close or too far", () => {
    const near = planTrade(1, 100, 2, { price: 99.5, touches: 2 }, null, cfg);
    const far = planTrade(1, 100, 2, { price: 90, touches: 2 }, null, cfg);
    expect(near.ok && near.plan.stop.method).toBe("ATR");
    expect(far.ok && far.plan.stop.method).toBe("ATR");
  });
  it("caps TP1 before a nearby resistance", () => {
    const r = planTrade(1, 100, 2, null, { price: 104, touches: 2 }, cfg);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.targets[0]).toBeLessThan(104);
    expect(r.plan.targets[0]).toBeLessThan(r.plan.targets[1]);
    expect(r.plan.targets[1]).toBeLessThan(r.plan.targets[2]);
  });
  it("rejects when the opposing level leaves less than 1R", () => {
    const r = planTrade(1, 100, 2, null, { price: 101.5, touches: 2 }, cfg);
    expect(r.ok).toBe(false);
  });
  it("rejects invalid inputs", () => {
    expect(planTrade(1, NaN, 2, null, null).ok).toBe(false);
    expect(planTrade(1, 100, 0, null, null).ok).toBe(false);
    expect(planTrade(1, 1, 5, null, null).ok).toBe(false); // stop would go below 0
  });
});

describe("buildSignal", () => {
  it("LONG trade has valid, ordered levels and a consistent score", () => {
    const c = series(250, 0.25);
    const s = buildSignal(base(c), { now: NOW(c), id: "t1", config: { minScore: 0 } });
    expect(s.direction).toBe("LONG");
    expect(s.symbol).toBe("BTCUSDT");
    const sl = s.stopLoss.price!, { tp1, tp2, tp3 } = s.takeProfit;
    expect(sl).toBeLessThan(s.entry.ideal);
    expect(tp1!).toBeGreaterThan(s.entry.ideal);
    expect(tp1!).toBeLessThan(tp2!);
    expect(tp2!).toBeLessThan(tp3!);
    expect(s.riskReward.weighted).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minWeightedR);
    expect(s.status).toBe("ACTIVE");
    expect(s.dataQuality.status).toBe("PARTIAL"); // no derivatives/news given
    expect(new Date(s.entry.expiry).getTime()).toBeGreaterThan(NOW(c));
  });

  it("SHORT trade has stop above entry and targets below", () => {
    const c = series(250, -0.25, 11, 200);
    const s = buildSignal(base(c), { now: NOW(c), config: { minScore: 0 } });
    expect(s.direction).toBe("SHORT");
    expect(s.stopLoss.price!).toBeGreaterThan(s.entry.ideal);
    expect(s.takeProfit.tp1!).toBeLessThan(s.entry.ideal);
    expect(s.takeProfit.tp3!).toBeLessThan(s.takeProfit.tp2!);
  });

  it("min-score filter turns a valid side into WAIT with no levels", () => {
    const c = series(250, 0.25);
    const s = buildSignal(base(c), { now: NOW(c), config: { minScore: 101 } });
    expect(s.direction).toBe("WAIT");
    expect(s.stopLoss.price).toBeNull();
    expect(s.takeProfit).toEqual({ tp1: null, tp2: null, tp3: null });
    expect(s.riskReward.weighted).toBe(0);
    expect(s.status).toBe("INACTIVE");
  });

  it("critical failure (high-impact news) overrides a good score -> NO_TRADE", () => {
    const c = series(250, 0.25);
    const s = buildSignal({ ...base(c), news: { sentiment: 0.5, highImpactSoon: true } }, { now: NOW(c), config: { minScore: 0 } });
    expect(s.direction).toBe("NO_TRADE");
    expect(s.stopLoss.price).toBeNull();
    expect(s.reasoning.primaryReason).toMatch(/news/i);
  });

  it("fewer than 60 candles -> NO_TRADE, data UNAVAILABLE, score 0", () => {
    const c = series(40, 0.25);
    const s = buildSignal(base(c), { now: NOW(c) });
    expect(s.direction).toBe("NO_TRADE");
    expect(s.score.total).toBe(0);
    expect(s.dataQuality.status).toBe("UNAVAILABLE");
  });

  it("empty candles do not throw", () => {
    const s = buildSignal(base([]), { now: T0 });
    expect(s.direction).toBe("NO_TRADE");
    expect(s.market.currentPrice).toBe(0);
  });

  it("old last candle marks data DELAYED", () => {
    const c = series(250, 0.25);
    const s = buildSignal(base(c), { now: NOW(c) + 10 * HOUR, config: { minScore: 0 } });
    expect(s.dataQuality.status).toBe("DELAYED");
  });

  it("score keys match FinalSignal.score and stay within max", () => {
    const c = series(250, 0.25);
    const s = buildSignal(base(c), { now: NOW(c) });
    expect(Object.keys(s.score).sort()).toEqual(["derivativesOrderbook", "liquiditySR", "marketContext", "newsFundamentals", "riskExecution", "structure", "total", "trendMTF", "volumeMomentum"]);
    expect(s.score.total).toBeLessThanOrEqual(100);
  });

  it("full data at the DEFAULT min score produces a FRESH LONG and SHORT", () => {
    for (const dir of [1, -1]) {
      const start = dir > 0 ? 100 : 200;
      const c = series(250, 0.25 * dir, 7, start);
      const s = buildSignal({
        ...base(c), confirmation: series(250, 0.25 * dir, 9, start), change24hPct: 1.5 * dir,
        derivatives: { fundingRate: 0, oiChangePct: 3, longShortRatio: 1, bookImbalance: 0.3 * dir },
        news: { sentiment: 0.4 * dir, highImpactSoon: false },
      }, { now: NOW(c) });
      expect(s.direction).toBe(dir > 0 ? "LONG" : "SHORT");
      expect(s.score.total).toBeGreaterThanOrEqual(65);
      expect(s.dataQuality.status).toBe("FRESH");
      expect(s.riskReward.tp1).toBeGreaterThanOrEqual(1);
    }
  });
});
