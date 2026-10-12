import { describe, expect, it } from "vitest";
import type { Candle, Liquidation } from "../shared/market.js";
import { buildSignal, STRATEGY_VERSION } from "../server/engine/signalBuilder.js";
import type { BuildSignalInput } from "../server/engine/signalBuilder.js";
import { confirmationWindow, lastClosedIndex, windowAt } from "../server/engine/backtestData.js";
import { runBacktest } from "../server/engine/backtest.js";
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
const base = (candles: Candle[]): BuildSignalInput => ({
  symbol: "btcusdt", exchange: "okx", marketType: "swap",
  timeframe: { primary: "1H", confirmation: "4H", execution: "5m" }, candles, change24hPct: 1.2,
});
const NOW = (c: Candle[]) => (c[c.length - 1]?.timestamp ?? T0) + HOUR;

describe("determinism", () => {
  it("identical inputs, config and now give an identical signal", () => {
    const c = series(250, 0.25);
    const a = buildSignal(base(c), { now: NOW(c), id: "fixed" });
    const b = buildSignal(base(c), { now: NOW(c), id: "fixed" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("the injected `now` (not the wall clock) decides which liquidation events are recent", () => {
    const c = series(250, 0.25);
    const now = NOW(c);
    const liquidations: Liquidation[] = [0, 1, 2, 3].map((i) => ({ timestamp: now - HOUR + i * 1000, side: "long", price: (c.at(-1) as Candle).close, quantity: 10 }));
    const s = buildSignal({ ...base(c), liquidations }, { now, id: "x" });
    expect((s.liquidation as { available?: boolean }).available).toBe(true);
  });
  it("every signal records the strategy version and scoring mode", () => {
    const c = series(250, 0.25);
    const s = buildSignal(base(c), { now: NOW(c) });
    expect(s.strategy?.version).toBe(STRATEGY_VERSION);
    expect(["CORE4", "FULL"]).toContain(s.strategy?.scoring);
  });
});

describe("multi-timeframe alignment (no look-ahead)", () => {
  const H4 = 4 * HOUR;
  const conf: Candle[] = Array.from({ length: 10 }, (_, i) => ({ timestamp: T0 + i * H4, open: 1, high: 2, low: 1, close: 1.5, volume: 1 }));
  it("a 4H candle is usable only once it has fully closed", () => {
    expect(lastClosedIndex(conf, H4, T0 + 3 * H4)).toBe(2);
    expect(lastClosedIndex(conf, H4, T0 + 3 * H4 - 1)).toBe(1);
    expect(lastClosedIndex(conf, H4, T0 + 3 * H4 + 1)).toBe(2);
    expect(lastClosedIndex(conf, H4, T0)).toBe(-1);
  });
  it("confirmationWindow never contains a candle that closes after the decision time", () => {
    const t = T0 + 5 * H4 + 2 * HOUR;
    const w = confirmationWindow(conf, H4, t) ?? [];
    expect(w.length).toBeGreaterThan(0);
    for (const k of w) expect(k.timestamp + H4).toBeLessThanOrEqual(t);
  });
  it("windowAt ends exactly at the decision candle", () => {
    const c = series(400, 0.1);
    expect(windowAt(c, 350).at(-1)?.timestamp).toBe(c[350]?.timestamp);
    expect(windowAt(c, 350)).toHaveLength(300);
  });
});

describe("backtest has no future leakage and is repeatable", () => {
  const opts = { timeframe: "1H" as const, testBars: 400, minScore: 50, costPct: 0.1, maxHoldBars: 48, btcFilter: false, maxOpenPerDirection: 0 };
  const hist = (p: Candle[]): SymbolHistory => ({ symbol: "ETHUSDT", timeframe: "1H", confTimeframe: null, primary: p, confirmation: null });
  const P = series(900, 0.04, 11, 100, 1.2);

  it("same data twice gives identical trades", async () => {
    const a = await runBacktest([hist(P)], null, opts);
    const b = await runBacktest([hist(P)], null, opts);
    expect(JSON.stringify(a.trades)).toBe(JSON.stringify(b.trades));
  });
  it("rewriting the last 60 candles does not change trades that finished before them", async () => {
    const cut = P.length - 60;
    const altered = P.map((k, i) => (i >= cut ? { ...k, open: k.open * 1.3, high: k.high * 1.3, low: k.low * 1.3, close: k.close * 1.3 } : k));
    const a = await runBacktest([hist(P)], null, opts);
    const b = await runBacktest([hist(altered)], null, opts);
    const cutTime = (P[cut] as Candle).timestamp;
    const early = (r: typeof a) => r.trades.filter((t) => t.exitTime <= cutTime);
    expect(early(a).length).toBeGreaterThan(0);
    expect(JSON.stringify(early(a))).toBe(JSON.stringify(early(b)));
  });
});
