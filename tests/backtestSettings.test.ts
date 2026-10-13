import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Candle } from "../shared/market.js";
import { describeEngineSettings } from "../shared/engineConfig.js";
import { MemorySettingsRepo, SettingsService } from "../server/engine/settingsStore.js";
import { createBacktestRouter, formatReport, resolveRunSettings } from "../server/engine/backtestReport.js";
import { buildReport } from "../server/engine/backtestReport.js";
import { runBacktest } from "../server/engine/backtest.js";
import type { ScanConfig } from "../server/config/env.js";

// Serve a synthetic history instead of calling the exchange.
vi.mock("../server/engine/backtestData.js", async (orig) => {
  const real = await orig<typeof import("../server/engine/backtestData.js")>();
  const HOUR = 3_600_000, T0 = Date.UTC(2026, 0, 1);
  let s = 11; const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  let price = 100;
  const primary = Array.from({ length: 1100 }, (_, i) => {
    const open = price; price = Math.max(1, open + 0.04 + (r() - 0.5) * 1.2);
    return { timestamp: T0 + i * HOUR, open, high: Math.max(open, price) + r() * 0.3, low: Math.min(open, price) - r() * 0.3, close: price, volume: 1000 + r() * 500 };
  });
  return { ...real, loadSymbolHistory: async (symbol: string, tf: string) => ({ symbol, timeframe: tf, confTimeframe: null, primary, confirmation: null }) };
});

const scan: ScanConfig = { enabled: false, intervalMs: 900000, symbols: ["ETHUSDT"], timeframe: "1H", minScore: 70, concurrency: 1 };
const OFF = { toggles: { rsi: false, macd: false, obv: false, stochRsi: false, bollinger: false } };

describe("resolveRunSettings", () => {
  const make = () => new SettingsService(new MemorySettingsRepo());
  it("without a settings service only the defaults can be used", async () => {
    expect((await resolveRunSettings(undefined, "default")).ok).toBe(true);
    const r = await resolveRunSettings(undefined, "active");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(400);
  });
  it("default = built-in defaults and reports what is live", async () => {
    const svc = make();
    const none = await resolveRunSettings(svc, "default");
    expect(none.ok && none.settings).toBeUndefined();
    expect(none.ok && none.info.liveKnown).toBe(true);
    expect(none.ok && none.info.liveVersion).toBeUndefined();
    await svc.createDraft(OFF, "", "a"); await svc.activate(1, "a");
    const live = await resolveRunSettings(svc, "default");
    expect(live.ok && live.info.liveVersion).toBe(1);
    expect(live.ok && live.settings).toBeUndefined();      // default still means defaults, even when v1 is live
  });
  it("active = the live version, or defaults when none is live", async () => {
    const svc = make();
    const none = await resolveRunSettings(svc, "active");
    expect(none.ok && none.info.label).toContain("no version is active");
    await svc.createDraft(OFF, "", "a"); await svc.activate(1, "a");
    const a = await resolveRunSettings(svc, "active");
    expect(a.ok && a.info.version).toBe(1);
    expect(a.ok && a.settings?.toggles.rsi).toBe(false);
  });
  it("a number picks that version, including a draft, and labels it", async () => {
    const svc = make();
    await svc.createDraft({ periods: { rsi: 10 } }, "", "a");
    const d = await resolveRunSettings(svc, 1);
    expect(d.ok && d.info.label).toContain("[draft, not live]");
    expect(d.ok && d.info.label).toContain("RSI period 10");
    expect(d.ok && d.settings?.periods.rsi).toBe(10);
  });
  it("an unknown version is an error", async () => {
    const r = await resolveRunSettings(make(), 42);
    expect(!r.ok && r.status).toBe(404);
  });
  it("describeEngineSettings lists only what differs", () => {
    expect(describeEngineSettings()).toBe("same as defaults");
    expect(describeEngineSettings({ periods: { rsi: 10 }, toggles: { macd: false } })).toBe("RSI period 10, MACD off");
  });
});

describe("formatReport with settings", () => {
  const T0 = Date.UTC(2026, 0, 1);
  let s = 5; const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  let price = 100;
  const primary: Candle[] = Array.from({ length: 900 }, (_, i) => {
    const open = price; price = Math.max(1, open + 0.04 + (r() - 0.5) * 1.2);
    return { timestamp: T0 + i * 3_600_000, open, high: Math.max(open, price) + 0.2, low: Math.min(open, price) - 0.2, close: price, volume: 1000 + r() * 500 };
  });
  const opts = { timeframe: "1H" as const, testBars: 400, minScore: 40, costPct: 0.1, maxHoldBars: 48, btcFilter: false, maxOpenPerDirection: 0 };
  it("is unchanged when no settings context is given, and adds clear lines when it is", async () => {
    const res = await runBacktest([{ symbol: "ETHUSDT", timeframe: "1H", confTimeframe: null, primary, confirmation: null }], null, opts);
    const rep = buildReport(res.trades);
    const plain = formatReport(res, rep, []);
    expect(plain).not.toContain("Engine    settings");
    const same = formatReport(res, rep, [], { label: "built-in defaults", liveKnown: true });
    expect(same).toContain("Engine    settings: built-in defaults");
    expect(same).toContain("same as live (built-in defaults)");
    const differ = formatReport(res, rep, [], { label: "v2 (MACD off)", version: 2, liveKnown: true, liveVersion: 1 });
    expect(differ).toContain("this run used v2 (MACD off); live is running v1");
    expect(formatReport(res, rep, [], { label: "built-in defaults", liveKnown: false })).toContain("could not tell which settings are live");
  });
});

describe("backtest endpoint with settings", () => {
  let server: Server; let base = "";
  const svc = new SettingsService(new MemorySettingsRepo());
  beforeAll(async () => {
    process.env["BACKTEST_KEY"] = "k";
    const app = express();
    app.use("/engine", createBacktestRouter(scan, svc));
    await new Promise<void>((res) => { server = app.listen(0, "127.0.0.1", () => res()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/engine/backtest`;
  });
  afterAll(() => new Promise<void>((res) => { server.close(() => res()); }));
  const get = async (q: string) => { const r = await fetch(`${base}?key=k&days=30&tf=1H&minScore=0&symbols=ETHUSDT&btc=0&profile=B${q}`); return { status: r.status, text: await r.text() }; };

  it("rejects bad or unknown settings values before running anything", async () => {
    expect((await get("&settings=abc")).status).toBe(400);
    expect((await get("&settings=0")).status).toBe(400);
    const missing = await get("&settings=99");
    expect(missing.status).toBe(404);
    expect(missing.text).toContain("does not exist");
  });
  it("still needs the key", async () => {
    const r = await fetch(`${base}?key=nope&settings=default`);
    expect(r.status).toBe(401);
  });
  it("defaults when the parameter is omitted, and says so", async () => {
    const r = await get("");
    expect(r.status).toBe(200);
    expect(r.text).toContain("Engine    settings: built-in defaults");
    expect(r.text).toContain("same as live (built-in defaults)");
  });
  it("can test a draft that is not live and warns that live differs", async () => {
    await svc.createDraft(OFF, "no momentum", "a");
    const r = await get("&settings=1");
    expect(r.status).toBe(200);
    expect(r.text).toContain("v1 [draft, not live]");
    expect(r.text).toContain("this run used v1");
    expect(r.text).toContain("live is running built-in defaults");
  });
  it("different settings change the result, so they are really being used", async () => {
    const a = JSON.parse((await get("&format=json")).text) as { trades: { score: number }[]; settings: { version: number | null } };
    const b = JSON.parse((await get("&settings=1&format=json")).text) as { trades: { score: number }[]; settings: { version: number | null } };
    expect(a.settings.version).toBeNull();
    expect(b.settings.version).toBe(1);
    expect(a.trades.length + b.trades.length).toBeGreaterThan(0);
    expect(JSON.stringify(b.trades)).not.toBe(JSON.stringify(a.trades));
  });
  it("settings=active follows the live version", async () => {
    await svc.activate(1, "a");
    const r = await get("&settings=active");
    expect(r.text).toContain("Engine    settings: v1 (");
    expect(r.text).toContain("same as live (v1)");
  });
  it("the same settings twice give the same result", async () => {
    const a = (await get("&settings=1&format=json")).text;
    const b = (await get("&settings=1&format=json")).text;
    expect(b).toBe(a);
  });
});
