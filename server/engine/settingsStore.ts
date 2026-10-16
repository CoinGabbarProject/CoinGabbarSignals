import type { Db } from "mongodb";
import { ENGINE_SETTINGS_SCHEMA, validateEngineSettings } from "../../shared/engineConfig.js";
import type { EngineSettings } from "../../shared/engineConfig.js";

/**
 * Versioned engine settings.
 *
 * Rules:
 *  - A saved version is never edited. Changing anything means saving a new draft.
 *  - A draft does nothing until it is activated. At most one version is active.
 *  - No active version = the built-in defaults (the behaviour before this feature existed).
 *  - Rollback re-activates the version that was active before the current one.
 *  - Every save, activation and reset records who did it and when.
 */

export type SettingsStatus = "draft" | "active" | "archived";

/** Which preset a draft started from. Informational only: the saved settings are the source of truth. */
export interface PresetRef {
  id: string;
  name: string;
  version: number;
  modified: boolean;                           // true when the saved values differ from the preset
  requiredData: ("derivatives" | "orderBook")[]; // data the engine must see fresh and complete before it may trade
}

export interface SettingsVersion {
  version: number;
  status: SettingsStatus;
  schema: number;                 // ENGINE_SETTINGS_SCHEMA when saved
    settings: EngineSettings;       // always the full, resolved values
  preset?: PresetRef;             // set when the draft was started from a preset
  note: string;
  createdAt: string;
  createdBy: string;
  activatedAt?: string;
  activatedBy?: string;
  archivedAt?: string;
}

export type SettingsErrorCode = "invalid" | "not_found" | "conflict";
export class SettingsError extends Error {
  constructor(readonly code: SettingsErrorCode, message: string, readonly details: string[] = []) {
    super(message);
    this.name = "SettingsError";
  }
}

/** Low-level storage. The rules above live in SettingsService, so every backend behaves the same. */
export interface SettingsRepo {
  nextVersion(): Promise<number>;
  insert(v: SettingsVersion): Promise<void>;
  get(version: number): Promise<SettingsVersion | null>;
  list(limit: number): Promise<SettingsVersion[]>;                       // newest first
  getActive(): Promise<SettingsVersion | null>;
  /** Fields set to undefined are removed. */
  patch(version: number, fields: Partial<SettingsVersion>): Promise<void>;
  /** The archived version with the latest activation time, skipping `exceptVersion`. */
  lastActivated(exceptVersion: number | null): Promise<SettingsVersion | null>;
}

const MAX_NOTE = 200;

export class SettingsService {
  constructor(private readonly repo: SettingsRepo, private readonly clock: () => number = Date.now) {}

  private iso(): string { return new Date(this.clock()).toISOString(); }

  list(limit = 50): Promise<SettingsVersion[]> { return this.repo.list(Math.min(200, Math.max(1, limit))); }
  get(version: number): Promise<SettingsVersion | null> { return this.repo.get(version); }
  getActive(): Promise<SettingsVersion | null> { return this.repo.getActive(); }

  /** Checks input without saving anything. */
  check(input: unknown): { ok: boolean; errors: string[]; settings: EngineSettings } {
    const top = topLevelErrors(input);
    const v = validateEngineSettings(isPlainObject(input) ? (input as never) : undefined);
    return { ok: top.length === 0 && v.ok, errors: [...top, ...v.errors], settings: v.settings };
  }

  async createDraft(input: unknown, note: unknown, by: string): Promise<SettingsVersion> {
    const checked = this.check(input);
    const errors = [...checked.errors];
    if (note !== undefined && typeof note !== "string") errors.push("note must be text");
    else if (typeof note === "string" && note.length > MAX_NOTE) errors.push(`note must be at most ${MAX_NOTE} characters`);
    if (errors.length > 0) throw new SettingsError("invalid", "Settings are not valid", errors);
    const v: SettingsVersion = {
      version: await this.repo.nextVersion(), status: "draft", schema: ENGINE_SETTINGS_SCHEMA,
      settings: checked.settings, note: typeof note === "string" ? note.trim() : "",
      createdAt: this.iso(), createdBy: by,
    };
    await this.repo.insert(v);
    return v;
  }

  async activate(version: number, by: string): Promise<SettingsVersion> {
    const target = await this.repo.get(version);
    if (!target) throw new SettingsError("not_found", `Version ${version} does not exist`);
    if (target.status === "active") return target;                       // already active: nothing to do
    if (target.schema !== ENGINE_SETTINGS_SCHEMA) throw new SettingsError("conflict", `Version ${version} was saved with an older settings format and cannot be activated`);
    const recheck = validateEngineSettings(target.settings);
    if (!recheck.ok) throw new SettingsError("conflict", `Version ${version} is no longer valid`, recheck.errors);

    const now = this.iso();
    const current = await this.repo.getActive();
    if (current) await this.repo.patch(current.version, { status: "archived", archivedAt: now });
    await this.repo.patch(version, { status: "active", activatedAt: now, activatedBy: by, archivedAt: undefined });
    return { ...target, status: "active", activatedAt: now, activatedBy: by, archivedAt: undefined };
  }

  /** Re-activates the version that was active before the current one. */
  async rollback(by: string): Promise<SettingsVersion> {
    const current = await this.repo.getActive();
    const prev = await this.repo.lastActivated(current?.version ?? null);
    if (!prev) throw new SettingsError("conflict", "There is no earlier active version to roll back to");
    return this.activate(prev.version, by);
  }

  /** Deactivates the active version so the engine uses the built-in defaults. Returns the version that was active, or null. */
  async reset(): Promise<SettingsVersion | null> {
    const current = await this.repo.getActive();
    if (!current) return null;
    const now = this.iso();
    await this.repo.patch(current.version, { status: "archived", archivedAt: now });
    return { ...current, status: "archived", archivedAt: now };
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function topLevelErrors(input: unknown): string[] {
  if (input === undefined) return [];
  if (!isPlainObject(input)) return ["settings must be an object with periods and/or toggles"];
  const errs: string[] = [];
  for (const k of Object.keys(input)) if (k !== "periods" && k !== "toggles") errs.push(`Unknown settings section: ${k}`);
  for (const k of ["periods", "toggles"]) if (k in input && !isPlainObject(input[k])) errs.push(`${k} must be an object`);
  return errs;
}

/** In-memory backend for tests and local runs. */
export class MemorySettingsRepo implements SettingsRepo {
  private rows = new Map<number, SettingsVersion>();
  private seq = 0;
  async nextVersion(): Promise<number> { return ++this.seq; }
  async insert(v: SettingsVersion): Promise<void> { this.rows.set(v.version, structuredClone(v)); }
  async get(version: number): Promise<SettingsVersion | null> { const r = this.rows.get(version); return r ? structuredClone(r) : null; }
  async list(limit: number): Promise<SettingsVersion[]> {
    return [...this.rows.values()].sort((a, b) => b.version - a.version).slice(0, limit).map((r) => structuredClone(r));
  }
  async getActive(): Promise<SettingsVersion | null> {
    const r = [...this.rows.values()].find((x) => x.status === "active");
    return r ? structuredClone(r) : null;
  }
  async patch(version: number, fields: Partial<SettingsVersion>): Promise<void> {
    const r = this.rows.get(version);
    if (!r) return;
    for (const [k, val] of Object.entries(fields)) {
      if (val === undefined) delete (r as unknown as Record<string, unknown>)[k];
      else (r as unknown as Record<string, unknown>)[k] = val;
    }
  }
  async lastActivated(exceptVersion: number | null): Promise<SettingsVersion | null> {
    const c = [...this.rows.values()].filter((x) => x.status === "archived" && x.activatedAt !== undefined && x.version !== exceptVersion);
    c.sort((a, b) => String(b.activatedAt).localeCompare(String(a.activatedAt)) || b.version - a.version);
    return c[0] ? structuredClone(c[0]) : null;
  }
}

type Row = Omit<SettingsVersion, "version"> & { _id: number };
const toVersion = (d: Row): SettingsVersion => { const { _id, ...rest } = d; return { version: _id, ...rest }; };

/** MongoDB backend. Separate collections from the signal data. */
export class MongoSettingsRepo implements SettingsRepo {
  constructor(private readonly db: Db) {}
  private rows = () => this.db.collection<Row>("engine_settings");
  private meta = () => this.db.collection<{ _id: string; seq: number }>("engine_settings_meta");

  async ensureIndexes(): Promise<void> {
    // The database itself refuses a second active version.
    await this.rows().createIndex({ status: 1 }, { unique: true, partialFilterExpression: { status: "active" } });
    await this.rows().createIndex({ status: 1, activatedAt: -1 });
  }
  async nextVersion(): Promise<number> {
    const d = await this.meta().findOneAndUpdate({ _id: "settings_version" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
    if (!d) throw new Error("Could not allocate a settings version number");
    return d.seq;
  }
  async insert(v: SettingsVersion): Promise<void> {
    const { version, ...rest } = v;
    await this.rows().insertOne({ _id: version, ...rest });
  }
  async get(version: number): Promise<SettingsVersion | null> {
    const d = await this.rows().findOne({ _id: version });
    return d ? toVersion(d) : null;
  }
  async list(limit: number): Promise<SettingsVersion[]> {
    return (await this.rows().find().sort({ _id: -1 }).limit(limit).toArray()).map(toVersion);
  }
  async getActive(): Promise<SettingsVersion | null> {
    const d = await this.rows().findOne({ status: "active" });
    return d ? toVersion(d) : null;
  }
  async patch(version: number, fields: Partial<SettingsVersion>): Promise<void> {
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const [k, val] of Object.entries(fields)) { if (val === undefined) $unset[k] = ""; else $set[k] = val; }
    const update: Record<string, unknown> = {};
    if (Object.keys($set).length) update["$set"] = $set;
    if (Object.keys($unset).length) update["$unset"] = $unset;
    if (Object.keys(update).length) await this.rows().updateOne({ _id: version }, update);
  }
  async lastActivated(exceptVersion: number | null): Promise<SettingsVersion | null> {
    const q: Record<string, unknown> = { status: "archived", activatedAt: { $exists: true } };
    if (exceptVersion !== null) q["_id"] = { $ne: exceptVersion };
    const d = await this.rows().find(q).sort({ activatedAt: -1, _id: -1 }).limit(1).next();
    return d ? toVersion(d) : null;
  }
}
