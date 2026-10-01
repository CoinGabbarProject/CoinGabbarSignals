import { describe, expect, it } from "vitest";
import type { Candle } from "../shared/market.js";
import { adaptCandles, msToChartTime } from "../src/components/MarketChart/candleAdapter.js";

const colors = { up: "u", down: "d" };
const c = (timestamp: number, o: number, h: number, l: number, cl: number, volume: number): Candle => ({ timestamp, open: o, high: h, low: l, close: cl, volume });

describe("MarketChart candle adapter", () => {
  it("converts epoch milliseconds to UTC seconds without shifting time", () => {
    // 2024-01-01T00:00:00.000Z
    expect(msToChartTime(1704067200000)).toBe(1704067200);
    expect(msToChartTime(1704067200999)).toBe(1704067200);
  });

  it("sorts, de-duplicates and drops invalid candles", () => {
    const r = adaptCandles([c(2000, 1, 2, 0.5, 1.5, 3), c(1000, 1, 2, 0.5, 1.5, 3), c(1000, 9, 9, 9, 9, 9), c(3000, NaN, 1, 1, 1, 1)], colors);
    expect(r.candles.map((x) => x.time)).toEqual([1, 2]);
    expect(r.candles[0]?.open).toBe(1);
    expect(r.dropped).toBe(2);
  });

  it("emits volume only when present and colours by direction", () => {
    const r = adaptCandles([c(1000, 1, 2, 1, 2, 5), c(2000, 2, 2, 1, 1, 7)], colors);
    expect(r.hasVolume).toBe(true);
    expect(r.volume.map((v) => v.color)).toEqual(["u", "d"]);
    expect(adaptCandles([c(1000, 1, 2, 1, 2, 0)], colors).hasVolume).toBe(false);
  });

  it("returns empty output for empty input (no fabricated data)", () => {
    expect(adaptCandles([], colors)).toEqual({ candles: [], volume: [], hasVolume: false, dropped: 0 });
  });
});
