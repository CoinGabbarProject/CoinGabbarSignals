import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DEFAULT_ENGINE_SETTINGS, validateEngineSettings } from "../shared/engineConfig.js";
import type { IndicatorToggles } from "../shared/engineConfig.js";
import {
  BUILTIN_PRESETS, applyPreset, assessDerivativesData, backtestCaveats, diffSettings, getBuiltinPreset, presetWarnings, summarizeSettings, validatePresetSettings,
} from "../shared/presets.js";
import { MemoryPresetRepo, PresetService } from "../server/engine/presetStore.js";
import { MemorySettingsRepo, SettingsService } from "../server/engine/settingsStore.js";
import { createSettingsRouter } from "../server/routes/settings.js";
import { buildSignal } from "../server/engine/signalBuilder.js";
import type { Candle } from "../shared/market.js";

const ON: Record<string, (keyof IndicatorToggles)[]> = {
  "trend-sr": ["macd", "vwap", "pivots"],
  "momentum-confirmation": ["rsi", "macd", "stochRsi", "obv"],
  "breakout-volatility": ["bollinger", "obv", "vwap", "pivots"],
  "derivatives-liquidity": ["derivatives", "orderBook", "liquidation", "obv", "vwap"],
  "smart-money-structure": ["smc", "pivots", "liquidation", "vwap"],
  "range-reversal": ["rsi", "stochRsi", "bollinger", "vwap", "pivots"],
};
const ALL = Object.keys(DEFAULT_ENGINE_SETTINGS.toggles) as (keyof IndicatorToggles)[];

describe("built-in presets", () => {
  it("has exactly the six presets", () => { expect(BUILTIN_PRESETS.map((p) => p.id).sort()).toEqual(Object.keys(ON).sort()); });
  for (const [id, on] of Object.entries(ON)) {
    it(`${id} enables and disables the intended indicators`, () => {
      const s = applyPreset(getBuiltinPreset(id)!);
      for (const k of ALL) expect(s.toggles[k], `${id}.${k}`).toBe(on.includes(k));
      expect(validateEngineSettings(s).ok).toBe(true);
    });
    it(`${id} has all required indicators switched on and stores its metadata`, () => {
      const p = getBuiltinPreset(id)!;
      expect(presetWarnings(p, p.settings)).toEqual([]);
      expect(p).toMatchObject({ version: 1, createdBy: "system", status: "builtin" });
      expect(Number.isNaN(Date.parse(p.createdAt))).toBe(false);
    });
  }
  it("editing a form copy never changes the preset", () => {
    const p = getBuiltinPreset("momentum-confirmation")!;
    const s = applyPreset(p);
    s.toggles.rsi = false; s.periods.rsi = 5;
    expect(getBuiltinPreset("momentum-confirmation")!.settings.toggles.rsi).toBe(true);
    expect(getBuiltinPreset("momentum-confirmation")!.settings.periods.rsi).toBe(14);
    expect(getBuiltinPreset("trend-sr")!.settings.toggles.macd).toBe(true);
  });
  it("never switches off safety: settings cannot name ATR or safety checks", () => {
    expect(validateEngineSettings({ toggles: { atr: false } as never }).ok).toBe(false);
    expect(validateEngineSettings({ toggles: { staleCheck: false } as never }).ok).toBe(false);
    expect(summarizeSettings({}).safety).toEqual(expect.arrayContaining(["Stale-data check", "Spread check", "Valid stop-loss check"]));
  });
});

describe("summary, warnings, comparison", () => {
  it("warns when a required indicator is disabled", () => {
    const p = getBuiltinPreset("range-reversal")!;
    const s = applyPreset(p); s.toggles.bollinger = false;
    expect(presetWarnings(p, s).join(" ")).toContain("Bollinger Bands is required");
  });
  it("warns that order book does nothing without derivatives", () => {
    expect(presetWarnings({ name: "x", required: [] }, { toggles: { derivatives: false, orderBook: true } }).length).toBe(1);
  });
  it("summary has no score and marks correlated indicators as one family", () => {
    const sm = summarizeSettings(getBuiltinPreset("momentum-confirmation")!.settings);
    expect(Object.keys(sm)).not.toContain("score");
    const mom = sm.families.find((f) => f.id === "momentum")!;
    expect(mom.enabled.length).toBe(3);
    expect(mom.note).toMatch(/not independent/);
    expect(sm.notes.join(" ")).toMatch(/not a measure of signal quality/);
  });
  it("compare lists only the indicators and periods that differ", () => {
    const a = getBuiltinPreset("trend-sr")!.settings, b = getBuiltinPreset("momentum-confirmation")!.settings;
    const d = diffSettings(a, b);
    expect(d.toggles.map((t) => t.key).sort()).toEqual(["obv", "pivots", "rsi", "stochRsi", "vwap"].sort());
    expect(diffSettings(a, a).same).toBe(true);
    expect(diffSettings(a, { ...a, periods: { ...a.periods, rsi: 9 } }).periods).toEqual([{ key: "rsi", a: 14, b: 9 }]);
  });
  it("does not claim derivatives presets are backtested", () => {
    expect(backtestCaveats(getBuiltinPreset("derivatives-liquidity")!.settings).length).toBe(2);
    expect(backtestCaveats(getBuiltinPreset("trend-sr")!.settings)).toEqual([]);
  });
});

describe("parameter validation", () => {
  it("rejects values outside the configured min/max and wrong types", () => {
    expect(validatePresetSettings({ periods: { rsi: 1 } }).ok).toBe(false);
    expect(validatePresetSettings({ periods: { rsi: 51 } }).ok).toBe(false);
    expect(validatePresetSettings({ periods: { bbMult: 5.1 } }).ok).toBe(false);
    expect(validatePresetSettings({ periods: { rsi: 10.5 } }).ok).toBe(false);
    expect(validatePresetSettings({ periods: { emaFast: 60, emaSlow: 50 } }).ok).toBe(false);
    expect(validatePresetSettings({ toggles: { rsi: "yes" } }).ok).toBe(false);
    expect(validatePresetSettings({ other: 1 }).ok).toBe(false);
    expect(validatePresetSettings(null).ok).toBe(false);
    expect(validatePresetSettings({ periods: { rsi: 2 }, toggles: { rsi: false } }).ok).toBe(true);
  });
});

describe("custom preset store", () => {
  const make = () => { let t = Date.UTC(2026, 9, 15); return new PresetService(new MemoryPresetRepo(), () => (t += 1000)); };
  it("saves, loads, versions and records creator and time", async () => {
    const svc = make();
    const a = await svc.saveCustom({ name: " Mine ", settings: { toggles: { obv: false } } }, "admin@x.com");
    expect(a).toMatchObject({ name: "Mine", version: 1, createdBy: "admin@x.com", status: "saved" });
    const b = await svc.saveCustom({ name: "mine", settings: { toggles: { obv: true } } }, "admin@x.com");
    expect(b.version).toBe(2);
    expect((await svc.get(a.id))!.settings.toggles.obv).toBe(false);   // old version untouched
    expect((await svc.listCustom()).length).toBe(2);
  });
  it("rejects invalid parameters and built-in names", async () => {
    const svc = make();
    await expect(svc.saveCustom({ name: "x", settings: { periods: { rsi: 999 } } }, "a")).rejects.toMatchObject({ code: "invalid" });
    await expect(svc.saveCustom({ name: "", settings: {} }, "a")).rejects.toMatchObject({ code: "invalid" });
    await expect(svc.saveCustom({ name: "Range + Reversal", settings: {} }, "a")).rejects.toMatchObject({ code: "conflict" });
  });
  it("duplicate copies without changing the source; custom changes never touch another preset", async () => {
    const svc = make();
    const copy = await svc.duplicate("momentum-confirmation", undefined, "a");
    expect(copy.name).toBe("Copy of Momentum Confirmation");
    const edited = await svc.saveCustom({ name: copy.name, settings: { ...copy.settings, toggles: { ...copy.settings.toggles, rsi: false } } }, "a");
    expect(edited.version).toBe(2);
    expect((await svc.get(copy.id))!.settings.toggles.rsi).toBe(true);
    expect(getBuiltinPreset("momentum-confirmation")!.settings.toggles.rsi).toBe(true);
    await expect(svc.duplicate("nope", undefined, "a")).rejects.toMatchObject({ code: "not_found" });
  });
  it("archives custom presets but never built-ins", async () => {
    const svc = make();
    const c = await svc.saveCustom({ name: "Z", settings: {} }, "a");
    await svc.archive(c.id);
    expect(await svc.listCustom()).toEqual([]);
    expect((await svc.listCustom(true)).length).toBe(1);
    await expect(svc.archive("trend-sr")).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("preset API, authorization and version history", () => {
  const SECRET = "test-secret-test-secret-test-secret-123";
  let server: Server; let base = "";
  const tok = (role: string) => jwt.sign({ userId: "1", email: `${role}@x.com`, role }, SECRET, { algorithm: "HS256" });
  const call = async (method: string, path: string, who: string | null, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(who ? { Authorization: `Bearer ${tok(who)}` } : {}) }, ...(body !== undefined && method !== "GET" ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, json: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  beforeAll(async () => {
    process.env["JWT_SECRET"] = SECRET;
    const app = express(); app.use(express.json());
    app.use("/api/v1", createSettingsRouter(new SettingsService(new MemorySettingsRepo()), new PresetService(new MemoryPresetRepo())));
    await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  afterAll(() => new Promise<void>((r) => { server.close(() => r()); }));

  it("needs login and admin for every preset route", async () => {
    for (const [m, p] of [["GET", "/engine/presets"], ["POST", "/engine/presets"], ["POST", "/engine/presets/summary"], ["POST", "/engine/presets/compare"], ["POST", "/engine/presets/trend-sr/duplicate"]] as const) {
      expect((await call(m, p, null, {})).status, p).toBe(401);
      expect((await call(m, p, "user", {})).status, p).toBe(403);
    }
  });
  it("unauthorized users cannot activate configurations", async () => {
    expect((await call("POST", "/engine/settings/1/activate", null)).status).toBe(401);
    expect((await call("POST", "/engine/settings/1/activate", "user")).status).toBe(403);
  });
  it("saving a preset or a draft never activates anything; activation stays a separate admin step", async () => {
    await call("POST", "/engine/presets", "admin", { name: "Mine", settings: { toggles: { obv: false } } });
    const p = getBuiltinPreset("range-reversal")!;
    const d = await call("POST", "/engine/settings/drafts", "admin", { settings: p.settings, presetId: p.id, note: "rr" });
    expect(d.status).toBe(201);
    expect(d.json["version"].preset).toMatchObject({ id: "range-reversal", modified: false, requiredData: [] });
    expect((await call("GET", "/engine/settings", "admin")).json["active"]).toBeNull();
    const d2 = await call("POST", "/engine/settings/drafts", "admin", { settings: { ...p.settings, toggles: { ...p.settings.toggles, rsi: false } }, presetId: p.id });
    expect(d2.json["version"].preset.modified).toBe(true);
    expect((await call("POST", `/engine/settings/${d.json["version"].version}/activate`, "admin")).status).toBe(200);
    const list = (await call("GET", "/engine/settings", "admin")).json;
    expect(list["versions"].length).toBe(2);
    expect(list["active"].version).toBe(d.json["version"].version);
  });
  it("derivatives preset records the data it requires; unknown presetId is rejected", async () => {
    const p = getBuiltinPreset("derivatives-liquidity")!;
    const d = await call("POST", "/engine/settings/drafts", "admin", { settings: p.settings, presetId: p.id });
    expect(d.json["version"].preset.requiredData).toEqual(["derivatives", "orderBook"]);
    expect((await call("POST", "/engine/settings/drafts", "admin", { settings: {}, presetId: "nope" })).status).toBe(400);
  });
  it("rejects invalid parameters on every path", async () => {
    expect((await call("POST", "/engine/presets", "admin", { name: "Bad", settings: { periods: { rsi: 1 } } })).status).toBe(400);
    expect((await call("POST", "/engine/presets/summary", "admin", { settings: { periods: { rsi: 1 } } })).status).toBe(400);
    expect((await call("POST", "/engine/settings/drafts", "admin", { settings: { periods: { rsi: 1 } } })).status).toBe(400);
  });
  it("summary, compare, duplicate and archive work", async () => {
    const s = await call("POST", "/engine/presets/summary", "admin", { settings: { toggles: { bollinger: false } }, presetId: "range-reversal" });
    expect(s.json["warnings"].join(" ")).toContain("Bollinger Bands is required");
    const c = await call("POST", "/engine/presets/compare", "admin", { a: "trend-sr", b: "range-reversal" });
    expect(c.json["diff"].toggles.length).toBeGreaterThan(0);
    expect((await call("POST", "/engine/presets/compare", "admin", { a: "trend-sr", b: "nope" })).status).toBe(404);
    const dup = await call("POST", "/engine/presets/trend-sr/duplicate", "admin", {});
    expect(dup.status).toBe(201);
    expect((await call("POST", `/engine/presets/${dup.json["preset"].id}/archive`, "admin")).status).toBe(200);
    expect((await call("POST", "/engine/presets/trend-sr/archive", "admin")).status).toBe(409);
  });
});

describe("data validation and engine safety", () => {
  const NOW = Date.UTC(2026, 9, 15, 12);
  const full = { fundingRate: 0, oiChangePct: 1, longShortRatio: 1.1, bookImbalance: 0.1, asOf: NOW - 1000, source: "okx" };
  it("treats a real 0 as available and null as unavailable", () => {
    const a = assessDerivativesData(full, ["derivatives", "orderBook"], NOW, 300_000);
    expect(a.ok).toBe(true); expect(a.fields.fundingRate).toBe("ok");
    const b = assessDerivativesData({ ...full, fundingRate: null }, ["derivatives"], NOW, 300_000);
    expect(b.ok).toBe(false); expect(b.fields.fundingRate).toBe("unavailable");
  });
  it("fails on missing, stale, future or source-less data", () => {
    const need = ["derivatives", "orderBook"] as const;
    expect(assessDerivativesData(null, need, NOW, 300_000).ok).toBe(false);
    expect(assessDerivativesData({ ...full, bookImbalance: null }, need, NOW, 300_000).reasons.join()).toMatch(/Order-book/);
    expect(assessDerivativesData({ ...full, asOf: NOW - 600_000 }, need, NOW, 300_000).reasons.join()).toMatch(/stale/);
    expect(assessDerivativesData({ ...full, asOf: NOW + 3_600_000 }, need, NOW, 300_000).reasons.join()).toMatch(/future/);
    expect(assessDerivativesData({ ...full, asOf: null }, need, NOW, 300_000).reasons.join()).toMatch(/timestamp/);
    expect(assessDerivativesData({ ...full, source: "" }, need, NOW, 300_000).reasons.join()).toMatch(/source/);
    expect(assessDerivativesData(null, [], NOW, 300_000).ok).toBe(true);   // nothing required -> nothing to check
  });

  // Same tradable fixture the signalBuilder tests use, so only the data gate can stop the trade.
  const HOUR = 3_600_000, T0 = Date.UTC(2026, 0, 1);
  const rng = (seed: number) => { let x = seed; return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296); };
  const series = (): Candle[] => {
    const r = rng(7); let price = 100;
    return Array.from({ length: 250 }, (_, i) => {
      const open = price; price = Math.max(1, open + 0.05 + (r() - 0.5) * 0.6);
      return { timestamp: T0 + i * HOUR, open, high: Math.max(open, price) + r() * 0.3, low: Math.min(open, price) - r() * 0.3, close: price, volume: 1000 + r() * 500 };
    });
  };
  const c = series();
  const lastAt = c[c.length - 1]!.timestamp;
  const T = lastAt + HOUR;                                     // "now" for the fresh case
  const run = (deriv: unknown, cfg: Record<string, unknown>, now = T) => buildSignal({
    symbol: "btcusdt", exchange: "okx", marketType: "swap", timeframe: { primary: "1H", confirmation: "4H", execution: "15m" },
    candles: c, change24hPct: 1.2, derivatives: deriv,
  } as never, { now, config: { minScore: 0, ...cfg } as never });
  const good = { ...full, asOf: T - 1000 };

  it("fixture is tradable without a required-data gate", () => { expect(run(good, {}).direction).toBe("LONG"); });
  it("required-data gate turns missing / stale / source-less feeds into NO_TRADE", () => {
    const cfg = { requiredData: ["derivatives", "orderBook"], settings: getBuiltinPreset("derivatives-liquidity")!.settings };
    expect(run(good, cfg).direction).toBe("LONG");             // good data passes
    for (const bad of [null, { ...good, fundingRate: null }, { ...good, bookImbalance: null }, { ...good, asOf: T - 3_600_000 }, { ...good, source: null }, { ...good, asOf: null }]) {
      const s = run(bad, cfg);
      expect(s.direction).toBe("NO_TRADE");
      expect(s.reasoning.primaryReason).toMatch(/Required market data failed validation/);
    }
  });
  it("a real 0 funding rate is not treated as missing", () => {
    expect(run({ ...good, fundingRate: 0 }, { requiredData: ["derivatives"] }).direction).toBe("LONG");
  });
  it("stale candles still block a trade (existing safety check untouched)", () => {
    const s = run(good, { requiredData: ["derivatives"] }, lastAt + 20 * HOUR);
    expect(s.direction).toBe("NO_TRADE");
    expect(s.reasoning.primaryReason).toMatch(/stale/i);
  });
});
