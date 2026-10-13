import { afterEach, describe, expect, it } from "vitest";
import type { Candle } from "../shared/market.js";
import type { MarketData } from "../server/engine/marketData.js";
import { MemorySignalStore } from "../server/engine/store.js";
import { EngineService, buildForSymbol } from "../server/engine/scanner.js";
import type { EngineDeps } from "../server/engine/scanner.js";

const MIN30 = 30 * 60_000;
const T0 = Date.UTC(2026, 0, 1);
function rng(seed: number) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }
function series(n: number, drift: number, seed = 7, start = 100, noise = 0.6): Candle[] {
  const r = rng(seed); let price = start;
  return Array.from({ length: n }, (_, i) => {
    const open = price; price = Math.max(1, open + drift + (r() - 0.5) * noise);
    return { timestamp: T0 + i * MIN30, open, high: Math.max(open, price) + r() * 0.3, low: Math.min(open, price) - r() * 0.3, close: price, volume: 1000 + r() * 500 };
  });
}
const candles = series(300, 0.25);
const NOW = (candles.at(-1) as Candle).timestamp + MIN30;
const market: MarketData = {
  getCandles: async () => candles,
  getTicker24h: async () => ({ change24hPct: 1.1, volume24h: 1e9 }),
  getDerivatives: async () => ({ fundingRate: null, oiChangePct: null, longShortRatio: null, bookImbalance: null }),
  getMarketSnapshot: async () => { throw new Error("not used"); },
};
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const scan = { symbols: ["ETHUSDT"], timeframe: "30m" as const, minScore: 70, concurrency: 1, candleLimit: 300 };
const deps = (extra: Partial<EngineDeps> = {}): EngineDeps => ({ market, store: new MemorySignalStore(), now: () => NOW, log: quiet, ...extra });

const saved = process.env["STRATEGY_PROFILE"];
afterEach(() => { if (saved === undefined) delete process.env["STRATEGY_PROFILE"]; else process.env["STRATEGY_PROFILE"] = saved; });

describe("scanner and engine settings", () => {
  it("settings reach the strategy: switching indicators off changes the full-engine score", async () => {
    process.env["STRATEGY_PROFILE"] = "B";
    const plain = await buildForSymbol("ETHUSDT", "30m", scan, deps(), NOW, 0);
    const off = await buildForSymbol("ETHUSDT", "30m", scan, deps(), NOW, 0, { toggles: { rsi: false, macd: false, obv: false, stochRsi: false } });
    expect(JSON.stringify(off.signal.score)).not.toBe(JSON.stringify(plain.signal.score));
  });
  it("passing no settings gives the same signal as before", async () => {
    process.env["STRATEGY_PROFILE"] = "B";
    const a = await buildForSymbol("ETHUSDT", "30m", scan, deps(), NOW, 0);
    const b = await buildForSymbol("ETHUSDT", "30m", scan, deps(), NOW, 0, undefined);
    const c = await buildForSymbol("ETHUSDT", "30m", scan, deps(), NOW, 0, {});
    const strip = (x: typeof a) => JSON.stringify({ ...x.signal, id: 0 });
    expect(strip(b)).toBe(strip(a));
    expect(strip(c)).toBe(strip(a));
  });
  it("a scan records which settings version it used", async () => {
    const engine = new EngineService(deps({ activeSettings: async () => ({ version: 3, settings: { toggles: { obv: false } } }) }), scan);
    const run = await engine.runScan();
    expect(run.settingsVersion).toBe(3);
    expect(run.errors).toBe(0);
  });
  it("without active settings the scan runs on defaults and records no version", async () => {
    const withNone = new EngineService(deps({ activeSettings: async () => null }), scan);
    expect("settingsVersion" in (await withNone.runScan())).toBe(false);
    const withoutHook = new EngineService(deps(), scan);
    expect("settingsVersion" in (await withoutHook.runScan())).toBe(false);
  });
  it("every stored signal records the settings version it was built with", async () => {
    const store = new MemorySignalStore();
    await new EngineService(deps({ store, activeSettings: async () => ({ version: 3, settings: {} }) }), scan).runScan();
    const withVersion = await store.listLatest({ limit: 10 });
    expect(withVersion.length).toBeGreaterThan(0);
    expect(withVersion.every((x) => x.strategy?.settingsVersion === 3)).toBe(true);

    const plainStore = new MemorySignalStore();
    await new EngineService(deps({ store: plainStore }), scan).runScan();
    const plain = await plainStore.listLatest({ limit: 10 });
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.every((x) => x.strategy !== undefined && !("settingsVersion" in x.strategy))).toBe(true);   // defaults leave no version
  });
  it("if the settings cannot be read the scan fails instead of trading on other settings", async () => {
    const store = new MemorySignalStore();
    const engine = new EngineService(deps({ store, activeSettings: async () => { throw new Error("db down"); } }), scan);
    await expect(engine.runScan()).rejects.toThrow("db down");
    expect(engine.isScanning).toBe(false);                      // the lock is released, the next scan can run
    expect(await store.listLatest({ limit: 10 })).toEqual([]);  // nothing was written
  });
});
