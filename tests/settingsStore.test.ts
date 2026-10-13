import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_SETTINGS, ENGINE_SETTINGS_SCHEMA } from "../shared/engineConfig.js";
import { MemorySettingsRepo, SettingsError, SettingsService } from "../server/engine/settingsStore.js";

function make() {
  let t = Date.UTC(2026, 9, 13);
  const repo = new MemorySettingsRepo();
  const service = new SettingsService(repo, () => (t += 1000));
  return { repo, service };
}
const rejects = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(SettingsError);
  expect((e as SettingsError).code).toBe(code);
  return e as SettingsError;
};

describe("saving drafts", () => {
  it("saves resolved settings as a draft that is not active", async () => {
    const { service } = make();
    const v = await service.createDraft({ toggles: { macd: false } }, " try without macd ", "admin@x.com");
    expect(v.version).toBe(1);
    expect(v.status).toBe("draft");
    expect(v.schema).toBe(ENGINE_SETTINGS_SCHEMA);
    expect(v.note).toBe("try without macd");
    expect(v.createdBy).toBe("admin@x.com");
    expect(v.settings.toggles.macd).toBe(false);
    expect(v.settings.periods).toEqual(DEFAULT_ENGINE_SETTINGS.periods);   // missing fields filled with defaults
    expect(await service.getActive()).toBeNull();
  });
  it("numbers versions in order", async () => {
    const { service } = make();
    expect((await service.createDraft({}, "", "a")).version).toBe(1);
    expect((await service.createDraft({}, "", "a")).version).toBe(2);
    expect((await service.list()).map((v) => v.version)).toEqual([2, 1]);
  });
  it("rejects invalid settings with readable details and saves nothing", async () => {
    const { service } = make();
    const e = await rejects(service.createDraft({ periods: { rsi: 1 }, toggles: { atr: false } }, "", "a"), "invalid");
    expect(e.details.length).toBe(2);
    await rejects(service.createDraft("nope", "", "a"), "invalid");
    await rejects(service.createDraft([], "", "a"), "invalid");
    await rejects(service.createDraft({ gates: {} }, "", "a"), "invalid");
    await rejects(service.createDraft({ periods: [] }, "", "a"), "invalid");
    await rejects(service.createDraft({}, "x".repeat(201), "a"), "invalid");
    await rejects(service.createDraft({}, 5, "a"), "invalid");
    expect(await service.list()).toEqual([]);
  });
  it("check() validates without saving", async () => {
    const { service } = make();
    expect(service.check({ periods: { rsi: 10 } }).ok).toBe(true);
    expect(service.check({ periods: { rsi: 99 } }).ok).toBe(false);
    expect(await service.list()).toEqual([]);
  });
});

describe("activation", () => {
  it("activates a draft and keeps only one active version", async () => {
    const { service } = make();
    await service.createDraft({}, "", "a");
    await service.createDraft({ toggles: { obv: false } }, "", "a");
    const a = await service.activate(1, "boss");
    expect(a.status).toBe("active");
    expect(a.activatedBy).toBe("boss");
    await service.activate(2, "boss");
    expect((await service.getActive())?.version).toBe(2);
    expect((await service.get(1))?.status).toBe("archived");
    expect((await service.list()).filter((v) => v.status === "active")).toHaveLength(1);
  });
  it("activating the active version again changes nothing", async () => {
    const { service } = make();
    await service.createDraft({}, "", "a");
    const first = await service.activate(1, "a");
    const again = await service.activate(1, "b");
    expect(again.activatedAt).toBe(first.activatedAt);
    expect(again.activatedBy).toBe("a");
  });
  it("unknown versions are not found", async () => {
    const { service } = make();
    await rejects(service.activate(99, "a"), "not_found");
  });
  it("never changes the saved settings", async () => {
    const { service } = make();
    const d = await service.createDraft({ periods: { rsi: 9 } }, "", "a");
    await service.activate(1, "a");
    expect((await service.get(1))?.settings).toEqual(d.settings);
  });
  it("refuses a version saved with another settings format", async () => {
    const { repo, service } = make();
    await repo.insert({ version: 7, status: "draft", schema: ENGINE_SETTINGS_SCHEMA + 1, settings: structuredClone(DEFAULT_ENGINE_SETTINGS) as never, note: "", createdAt: "x", createdBy: "a" });
    await rejects(service.activate(7, "a"), "conflict");
  });
  it("refuses stored settings that are no longer valid", async () => {
    const { repo, service } = make();
    const bad = structuredClone(DEFAULT_ENGINE_SETTINGS) as never as { periods: { rsi: number } };
    bad.periods.rsi = 1;
    await repo.insert({ version: 8, status: "draft", schema: ENGINE_SETTINGS_SCHEMA, settings: bad as never, note: "", createdAt: "x", createdBy: "a" });
    await rejects(service.activate(8, "a"), "conflict");
  });
});

describe("rollback and reset", () => {
  it("rollback re-activates the previous version", async () => {
    const { service } = make();
    await service.createDraft({}, "", "a");
    await service.createDraft({ toggles: { rsi: false } }, "", "a");
    await service.activate(1, "a");
    await service.activate(2, "a");
    const back = await service.rollback("a");
    expect(back.version).toBe(1);
    expect((await service.getActive())?.version).toBe(1);
    expect((await service.get(2))?.status).toBe("archived");
  });
  it("rollback fails when there is nothing earlier", async () => {
    const { service } = make();
    await rejects(service.rollback("a"), "conflict");
    await service.createDraft({}, "", "a");
    await service.activate(1, "a");
    await rejects(service.rollback("a"), "conflict");
  });
  it("reset goes back to defaults and can be undone with a rollback", async () => {
    const { service } = make();
    await service.createDraft({ toggles: { vwap: false } }, "", "a");
    await service.activate(1, "a");
    const was = await service.reset();
    expect(was?.version).toBe(1);
    expect(await service.getActive()).toBeNull();
    expect((await service.rollback("a")).version).toBe(1);
  });
  it("reset with nothing active returns null", async () => {
    const { service } = make();
    expect(await service.reset()).toBeNull();
  });
});
