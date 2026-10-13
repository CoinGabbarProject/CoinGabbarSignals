import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createSettingsRouter } from "../server/routes/settings.js";
import { MemorySettingsRepo, SettingsService } from "../server/engine/settingsStore.js";

const SECRET = "test-secret-test-secret-test-secret-123";
interface V { version: number; status: string; createdBy: string; settings: { toggles: Record<string, boolean>; periods: Record<string, number> } }
interface Json { success?: boolean; error?: string; errors?: string[]; details?: string[]; usingDefaults?: boolean; active?: V | null; defaults?: V["settings"]; versions?: V[]; version?: V }
let server: Server;
let base = "";
const token = (role: string, email = `${role}@x.com`) => jwt.sign({ userId: "1", email, role }, SECRET, { algorithm: "HS256" });
const call = async (method: string, path: string, who: string | null, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(who ? { Authorization: `Bearer ${token(who)}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as Json };
};

beforeAll(async () => {
  process.env["JWT_SECRET"] = SECRET;
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createSettingsRouter(new SettingsService(new MemorySettingsRepo())));
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
afterAll(() => new Promise<void>((r) => { server.close(() => r()); }));

describe("settings API access", () => {
  it("needs a login", async () => {
    expect((await call("GET", "/engine/settings", null)).status).toBe(401);
    expect((await call("POST", "/engine/settings/drafts", null, { settings: {} })).status).toBe(401);
  });
  it("needs the admin role", async () => {
    expect((await call("GET", "/engine/settings", "user")).status).toBe(403);
    expect((await call("POST", "/engine/settings/drafts", "user", { settings: {} })).status).toBe(403);
    expect((await call("POST", "/engine/settings/1/activate", "user")).status).toBe(403);
    expect((await call("POST", "/engine/settings/rollback", "user")).status).toBe(403);
    expect((await call("POST", "/engine/settings/reset", "user")).status).toBe(403);
  });
});

describe("settings API flow", () => {
  it("starts on defaults with nothing active", async () => {
    const r = await call("GET", "/engine/settings", "admin");
    expect(r.status).toBe(200);
    expect(r.json.active).toBeNull();
    expect(r.json.defaults!.periods["rsi"]).toBe(14);
    expect(r.json.versions).toEqual([]);
  });
  it("validate checks without saving", async () => {
    const ok = await call("POST", "/engine/settings/validate", "admin", { settings: { periods: { rsi: 10 } } });
    expect(ok.status).toBe(200);
    const bad = await call("POST", "/engine/settings/validate", "admin", { settings: { periods: { rsi: 999 } } });
    expect(bad.status).toBe(400);
    expect(bad.json.errors!.length).toBe(1);
    expect((await call("GET", "/engine/settings", "admin")).json.versions).toEqual([]);
  });
  it("rejects an invalid draft with details", async () => {
    const r = await call("POST", "/engine/settings/drafts", "admin", { settings: { toggles: { macd: "no" } } });
    expect(r.status).toBe(400);
    expect(r.json.details!.length).toBeGreaterThan(0);
  });
  it("saves a draft, activates it, then rolls back and resets", async () => {
    const d1 = await call("POST", "/engine/settings/drafts", "admin", { settings: { toggles: { obv: false } }, note: "no obv" });
    expect(d1.status).toBe(201);
    expect(d1.json.version!.status).toBe("draft");
    expect(d1.json.version!.createdBy).toBe("admin@x.com");
    expect((await call("GET", "/engine/settings", "admin")).json.active).toBeNull();   // a draft changes nothing

    const a1 = await call("POST", `/engine/settings/${d1.json.version!.version}/activate`, "admin");
    expect(a1.status).toBe(200);
    expect((await call("GET", "/engine/settings", "admin")).json.active!.settings.toggles["obv"]).toBe(false);

    const d2 = await call("POST", "/engine/settings/drafts", "admin", { settings: { periods: { rsi: 10 } } });
    await call("POST", `/engine/settings/${d2.json.version!.version}/activate`, "admin");
    const rb = await call("POST", "/engine/settings/rollback", "admin");
    expect(rb.status).toBe(200);
    expect(rb.json.version!.version).toBe(d1.json.version!.version);

    const rs = await call("POST", "/engine/settings/reset", "admin");
    expect(rs.json.usingDefaults).toBe(true);
    expect((await call("GET", "/engine/settings", "admin")).json.active).toBeNull();
  });
  it("gives clear errors for bad or unknown versions", async () => {
    expect((await call("POST", "/engine/settings/999/activate", "admin")).status).toBe(404);
    expect((await call("POST", "/engine/settings/abc/activate", "admin")).status).toBe(400);
    expect((await call("POST", "/engine/settings/0/activate", "admin")).status).toBe(400);
    expect((await call("GET", "/engine/settings/999", "admin")).status).toBe(404);
    expect((await call("GET", "/engine/settings/-1", "admin")).status).toBe(400);
  });
  it("reads one version", async () => {
    const list = (await call("GET", "/engine/settings", "admin")).json.versions!;
    const one = await call("GET", `/engine/settings/${list[0]!.version}`, "admin");
    expect(one.status).toBe(200);
    expect(one.json.version!.version).toBe(list[0]!.version);
  });
});
