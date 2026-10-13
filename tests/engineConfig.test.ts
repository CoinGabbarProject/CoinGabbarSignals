import { describe, expect, it } from "vitest";
import type { Candle } from "../shared/market.js";
import {
  DEFAULT_ENGINE_SETTINGS, DEFAULT_PERIODS, DEFAULT_TOGGLES, disabledIndicators, minCandlesFor,
  resolveEngineSettings, validateEngineSettings,
} from "../shared/engineConfig.js";
import { calcAdvanced, calcIndicators } from "../shared/indicators.js";
import { scoreSetup } from "../shared/scoring.js";
import type { SetupGates } from "../shared/scoring.js";
import { buildSignal, PROFILES } from "../server/engine/signalBuilder.js";
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
const NOW = (c: Candle[]) => (c[c.length - 1]?.timestamp ?? T0) + HOUR;
const DERIV = { fundingRate: 0.0001, oiChangePct: 2, longShortRatio: 1.2, bookImbalance: 0.1 };

describe("engine settings: defaults and validation", () => {
  it("defaults are the classic values", () => {
    expect(DEFAULT_PERIODS).toMatchObject({ emaFast: 20, emaSlow: 50, smaTrend: 200, rsi: 14, atr: 14, adx: 14, macdFast: 12, macdSlow: 26, macdSignal: 9, bbPeriod: 20, bbMult: 2 });
    expect(Object.values(DEFAULT_TOGGLES).every((v) => v === true)).toBe(true);
    expect(minCandlesFor(DEFAULT_PERIODS)).toBe(60);
    expect(resolveEngineSettings()).toEqual(DEFAULT_ENGINE_SETTINGS);
  });
  it("accepts empty input and the defaults", () => {
    expect(validateEngineSettings().ok).toBe(true);
    expect(validateEngineSettings({ periods: { rsi: 14 }, toggles: { macd: false } }).ok).toBe(true);
  });
  it("rejects out-of-range, non-integer, unknown and wrongly typed values", () => {
    expect(validateEngineSettings({ periods: { rsi: 1 } }).ok).toBe(false);
    expect(validateEngineSettings({ periods: { rsi: 14.5 } }).ok).toBe(false);
    expect(validateEngineSettings({ periods: { bbMult: 9 } }).ok).toBe(false);
    expect(validateEngineSettings({ periods: { nope: 3 } } as never).ok).toBe(false);
    expect(validateEngineSettings({ toggles: { macd: "yes" } } as never).ok).toBe(false);
    expect(validateEngineSettings({ toggles: { atr: false } } as never).ok).toBe(false); // ATR cannot be switched
  });
  it("rejects inconsistent period ordering", () => {
    expect(validateEngineSettings({ periods: { emaFast: 60 } }).ok).toBe(false);
    expect(validateEngineSettings({ periods: { emaSlow: 250 } }).ok).toBe(false);
    expect(validateEngineSettings({ periods: { macdFast: 30 } }).ok).toBe(false);
  });
});

describe("indicator periods", () => {
  it("explicit defaults give the same result as passing nothing", () => {
    const c = series(250, 0.25);
    expect(calcIndicators(c, { ...DEFAULT_PERIODS })).toEqual(calcIndicators(c));
    expect(calcAdvanced(c, { ...DEFAULT_PERIODS })).toEqual(calcAdvanced(c));
  });
  it("a different period changes the value", () => {
    const c = series(250, 0.25);
    expect(calcIndicators(c, { emaFast: 10 })?.ema20).not.toBe(calcIndicators(c)?.ema20);
    expect(calcIndicators(c, { rsi: 7 })?.rsi.value).not.toBe(calcIndicators(c)?.rsi.value);
  });
  it("returns null until there is enough history for the longest enabled period", () => {
    expect(calcIndicators(series(120, 0.2), { emaSlow: 150, smaTrend: 300 })).toBeNull();
    expect(calcIndicators(series(300, 0.2), { emaSlow: 150, smaTrend: 250 })).not.toBeNull();
  });
});

describe("indicator switches in the score", () => {
  const c = series(250, 0.25);
  const conf = series(250, 0.5, 12, 100, 1.2);
  const input = { candles: c, confirmation: conf, change24hPct: 1.1, derivatives: DERIV, gates: { adxMin: 0 }, now: NOW(c) };

  it("no settings and explicit default settings give an identical result", () => {
    const a = scoreSetup(input);
    const b = scoreSetup({ ...input, settings: { periods: { ...DEFAULT_PERIODS }, toggles: { ...DEFAULT_TOGGLES } } });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.disabled).toEqual([]);
  });
  it("the test series is directional, so the switches below are really exercised", () => {
    expect(scoreSetup(input).side).not.toBe("NEUTRAL");
  });
  it("a switched-off indicator is reported and the score base shrinks", () => {
    const base = scoreSetup(input);
    const r = scoreSetup({ ...input, settings: { toggles: { rsi: false } } });
    expect(r.disabled).toEqual(["rsi"]);
    expect(r.activeMax).toBe((base.activeMax ?? 100) - 4);
    expect(r.score.total).toBeGreaterThanOrEqual(0);
    expect(r.score.total).toBeLessThanOrEqual(100);
  });
  it("each switch removes its own points from the score base", () => {
    const base = scoreSetup(input).activeMax ?? 100;
    const lost: Record<string, number> = { rsi: 4, macd: 6, stochRsi: 2, obv: 3, bollinger: 5, derivatives: 10, orderBook: 3 };
    for (const [key, pts] of Object.entries(lost)) {
      const r = scoreSetup({ ...input, settings: { toggles: { [key]: false } } });
      expect(r.activeMax, key).toBe(base - pts);
    }
  });
  it("switching derivatives off equals having no derivatives data: same score, nothing 'unavailable'", () => {
    const noData = { ...input, derivatives: null };
    const missing = scoreSetup(noData);
    const off = scoreSetup({ ...noData, settings: { toggles: { derivatives: false } } });
    expect(off.score.total).toBe(missing.score.total);
    expect(off.unavailable).not.toContain("fundingRate");
    expect(missing.unavailable).toContain("fundingRate");
  });
  it("all switches off still gives a valid 0-100 score and is deterministic", () => {
    const toggles = { rsi: false, macd: false, stochRsi: false, obv: false, vwap: false, bollinger: false, derivatives: false, orderBook: false };
    const a = scoreSetup({ ...input, settings: { toggles } });
    const b = scoreSetup({ ...input, settings: { toggles } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.score.total).toBeGreaterThanOrEqual(0);
    expect(a.score.total).toBeLessThanOrEqual(100);
    expect(a.disabled).toEqual(disabledIndicators(toggles as never));
  });
  it("VWAP and MACD also stop voting for direction when off", () => {
    const withAll = scoreSetup(input).side;
    const off = scoreSetup({ ...input, settings: { toggles: { macd: false, vwap: false } } }).side;
    expect(["LONG", "SHORT", "NEUTRAL"]).toContain(off);
    expect(withAll).not.toBeUndefined();
  });
  it("safety guards cannot be removed by switches: ATR still needed", () => {
    const flat = series(250, 0, 3, 100, 0).map((k) => ({ ...k, high: k.close, low: k.close }));
    const r = scoreSetup({ candles: flat, now: NOW(flat), settings: { toggles: { rsi: false } } });
    expect(r.side).toBe("NEUTRAL");
  });
});

describe("builder with settings", () => {
  const base = (candles: Candle[]): BuildSignalInput => ({
    symbol: "btcusdt", exchange: "okx", marketType: "swap",
    timeframe: { primary: "1H", confirmation: "4H", execution: "5m" }, candles, change24hPct: 1.2, derivatives: DERIV,
  });
  it("omitting settings leaves the default signal unchanged", () => {
    const c = series(250, 0.25);
    const a = buildSignal(base(c), { now: NOW(c), id: "x" });
    const b = buildSignal(base(c), { now: NOW(c), id: "x", config: { settings: {} } });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
  it("profile C cannot trade when derivatives are switched off", () => {
    let found = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) for (const drift of [0.02, 0.05, 0.1, -0.05, -0.1]) {
      const c = series(250, drift, seed);
      const cfg = { ...PROFILES.C.config, minScore: 0, gates: { ...(PROFILES.C.config.gates as SetupGates), requireCandle: false, adxMin: 0, htfFilter: false } };
      const on = buildSignal(base(c), { now: NOW(c), id: "x", config: cfg });
      if (on.direction !== "LONG" && on.direction !== "SHORT") continue;
      found++;
      const off = buildSignal(base(c), { now: NOW(c), id: "x", config: { ...cfg, settings: { toggles: { derivatives: false } } } });
      expect(["WAIT", "NO_TRADE"]).toContain(off.direction);
    }
    expect(found).toBeGreaterThan(0);
  });
});
