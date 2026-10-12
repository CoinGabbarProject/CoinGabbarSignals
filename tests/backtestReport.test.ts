import { describe, expect, it } from "vitest";
import type { Candle } from "../shared/market.js";
import { runBacktest } from "../server/engine/backtest.js";
import { bootstrapMeanCI, buildReport, buildValidation, formatReport, formatValidation } from "../server/engine/backtestReport.js";
import type { BacktestTrade } from "../server/engine/backtest.js";
import type { SymbolHistory } from "../server/engine/backtestData.js";

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
const P = series(900, 0.04, 11, 100, 1.2);
const hist: SymbolHistory = { symbol: "ETHUSDT", timeframe: "1H", confTimeframe: null, primary: P, confirmation: null };
const base = { timeframe: "1H" as const, testBars: 400, minScore: 50, costPct: 0.1, maxHoldBars: 48, btcFilter: false, maxOpenPerDirection: 0 };

describe("backtest report states its assumptions", () => {
  it("default run: fixed stop, funding off, and what is not replayed", async () => {
    const res = await runBacktest([hist], null, base);
    const text = formatReport(res, buildReport(res.trades), []);
    expect(text).toMatch(/stop fixed/);
    expect(text).toMatch(/funding off/);
    expect(text).toMatch(/PARITY WITH THE LIVE ENGINE/);
    expect(text).toMatch(/not replayed: derivatives, liquidations/);
  });
  it("staged run labels the stop mode, trail and the funding ASSUMPTION", async () => {
    const res = await runBacktest([hist], null, { ...base, stopMode: "staged", trailPct: 1.5, fundingPctPer8h: 0.01 });
    const text = formatReport(res, buildReport(res.trades), []);
    expect(text).toMatch(/stop staged trail 1.5%/);
    expect(text).toMatch(/\(assumed\)/);
  });
  it("staged runs are repeatable", async () => {
    const o = { ...base, stopMode: "staged" as const, trailPct: 1.5 };
    const a = await runBacktest([hist], null, o);
    const b = await runBacktest([hist], null, o);
    expect(JSON.stringify(a.trades)).toBe(JSON.stringify(b.trades));
  });
  it("trailing exits get their own label in the exit breakdown", () => {
    const t = { symbol: "A", direction: "LONG" as const, score: 80, decisionTime: 1, entryTime: 1, exitTime: 2, entry: 1, stop: 0.9, tp1: 1.1, tp2: 1.2, tp3: 1.3, plannedRR: 2, hits: 1 as const, reason: "TRAIL" as const, bars: 1, grossR: 0.5, r: 0.45 };
    expect(buildReport([t]).exits).toEqual({ "Trail after TP1": 1 });
  });
});
