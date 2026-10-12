import { describe, expect, it } from "vitest";
import { checkHardFilters, loadHardFilterConfig } from "../server/engine/marketData.js";
import type { MarketSnapshot } from "../server/engine/marketData.js";

const snap = (spread: number | null, volume24h = 5e6, timestamp = 1000): MarketSnapshot => ({
  ticker: { change24hPct: 0, volume24h },
  derivatives: { fundingRate: null, oiChangePct: null, longShortRatio: null, bookImbalance: null },
  orderBook: { bidVolume: 1, askVolume: 1, imbalance: 0, spread, midpoint: 100 },
  timestamp,
});
const on = loadHardFilterConfig({ HARD_FILTERS: "true", MIN_VOLUME_24H_USD: "1000000" });

describe("hard filters", () => {
  it("are off by default and never block", () => {
    const off = loadHardFilterConfig({});
    expect(off.enabled).toBe(false);
    expect(checkHardFilters(null, 0, off)).toBeNull();
    expect(checkHardFilters(snap(50), 1e9, off)).toBeNull();
  });
  it("pass a tight, liquid, fresh market", () => {
    expect(checkHardFilters(snap(0.05), 1000, on)).toBeNull();
  });
  it("block a wide spread", () => {
    expect(checkHardFilters(snap(0.2), 1000, on)).toMatch(/spread 0.200%/);
  });
  it("block when data is missing (fail closed)", () => {
    expect(checkHardFilters(null, 0, on)).toMatch(/snapshot unavailable/);
    expect(checkHardFilters(snap(null), 1000, on)).toMatch(/spread unavailable/);
    expect(checkHardFilters(snap(0.05, 0), 1000, on)).toMatch(/volume unavailable/);
  });
  it("block low volume and stale data", () => {
    expect(checkHardFilters(snap(0.05, 5e5), 1000, on)).toMatch(/below/);
    expect(checkHardFilters(snap(0.05), 30_000, on)).toMatch(/old/);
  });
  it("parse env with safe fallbacks", () => {
    const c = loadHardFilterConfig({ HARD_FILTERS: "yes", MAX_SPREAD_PCT: "abc", MAX_DATA_AGE_MS: "-5" });
    expect(c.enabled).toBe(true);
    expect(c.maxSpreadPct).toBe(0.1);
    expect(c.maxDataAgeMs).toBe(15_000);
  });
});
