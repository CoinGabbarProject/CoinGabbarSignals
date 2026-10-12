import { describe, expect, it } from "vitest";
import type { Candle } from "../shared/market.js";
import { applyClusterLimit, simulateTrade } from "../server/engine/backtest.js";
import type { BacktestTrade } from "../server/engine/backtest.js";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);
const k = (i: number, low: number, high: number, close = (low + high) / 2): Candle => ({ timestamp: T0 + i * HOUR, open: close, high, low, close, volume: 1 });
const W = [0.5, 0.3, 0.2] as const;

describe("simulateTrade accounting", () => {
  it("LONG hitting TP1, TP2 and TP3 in one candle: weighted R = 1.7", () => {
    const s = simulateTrade(1, 100, 98, [102, 104, 106], W, [k(0, 99, 107)], 0, 10, 0);
    expect(s?.reason).toBe("TP3");
    expect(s?.hits).toBe(3);
    expect(s?.grossR).toBeCloseTo(1.7, 10);
  });
  it("candle touching both stop and TP1 is a LOSS (conservative)", () => {
    const s = simulateTrade(1, 100, 98, [102, 104, 106], W, [k(0, 97, 103)], 0, 10, 0);
    expect(s?.reason).toBe("SL");
    expect(s?.hits).toBe(0);
    expect(s?.grossR).toBeCloseTo(-1, 10);
  });
  it("TP1 then stop: 0.5*1 - 0.3 - 0.2 = 0R (stop is NOT moved)", () => {
    const s = simulateTrade(1, 100, 98, [102, 104, 106], W, [k(0, 99, 102.5), k(1, 97, 101)], 0, 10, 0);
    expect(s?.hits).toBe(1);
    expect(s?.reason).toBe("SL");
    expect(s?.grossR).toBeCloseTo(0, 10);
  });
  it("round-trip cost is charged in R: 0.1% of 100 over a risk of 2 = 0.05R", () => {
    const s = simulateTrade(1, 100, 98, [102, 104, 106], W, [k(0, 99, 107)], 0, 10, 0.1);
    expect(s?.netR).toBeCloseTo(1.7 - 0.05, 10);
  });
  it("SHORT mirrors LONG", () => {
    const s = simulateTrade(-1, 100, 102, [98, 96, 94], W, [k(0, 93, 101)], 0, 10, 0);
    expect(s?.reason).toBe("TP3");
    expect(s?.grossR).toBeCloseTo(1.7, 10);
    const sl = simulateTrade(-1, 100, 102, [98, 96, 94], W, [k(0, 99, 103)], 0, 10, 0);
    expect(sl?.reason).toBe("SL");
  });
  it("no hit within maxHold closes at the last close as TIMEOUT", () => {
    const s = simulateTrade(1, 100, 98, [102, 104, 106], W, [k(0, 99, 101, 100.5), k(1, 99, 101, 100.8), k(2, 99, 101)], 0, 2, 0);
    expect(s?.reason).toBe("TIMEOUT");
    expect(s?.bars).toBe(2);
    expect(s?.exitPrice).toBe(100.8);
  });
  it("returns null when the stop is on the wrong side", () => {
    expect(simulateTrade(1, 100, 101, [102, 104, 106], W, [k(0, 99, 101)], 0, 5, 0)).toBeNull();
    expect(simulateTrade(-1, 100, 99, [98, 96, 94], W, [k(0, 99, 101)], 0, 5, 0)).toBeNull();
  });
});

describe("applyClusterLimit (overlapping trades)", () => {
  const t = (symbol: string, entryTime: number, exitTime: number, direction: "LONG" | "SHORT" = "LONG"): BacktestTrade => ({
    symbol, direction, score: 80, decisionTime: entryTime, entryTime, exitTime, entry: 1, stop: 0.9, tp1: 1.1, tp2: 1.2, tp3: 1.3,
    plannedRR: 2, hits: 0, reason: "SL", bars: 1, grossR: -1, r: -1,
  });
  it("keeps at most `max` simultaneous same-direction trades", () => {
    const { kept, dropped } = applyClusterLimit([t("A", 1, 10), t("B", 2, 10), t("C", 3, 10)], 2);
    expect(kept.map((x) => x.symbol)).toEqual(["A", "B"]);
    expect(dropped).toBe(1);
  });
  it("opposite directions and non-overlapping trades do not count against the limit", () => {
    const { kept } = applyClusterLimit([t("A", 1, 5), t("B", 6, 9), t("C", 2, 9, "SHORT")], 1);
    expect(kept).toHaveLength(3);
  });
  it("max 0 means no limit", () => { expect(applyClusterLimit([t("A", 1, 9), t("B", 2, 9)], 0).dropped).toBe(0); });
});
