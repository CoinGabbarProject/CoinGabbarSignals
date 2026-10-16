import type { Db } from "mongodb";
import { BUILTIN_PRESETS, clonePreset, getBuiltinPreset, validatePresetDescription, validatePresetName, validatePresetSettings } from "../../shared/presets.js";
import type { IndicatorPreset } from "../../shared/presets.js";
import { SettingsError } from "./settingsStore.js";

/**
 * Custom indicator presets.
 *
 * - Built-in presets live in code and cannot be changed.
 * - A saved custom preset is never edited. Saving the same name again creates the next version.
 * - Storing a preset never activates anything. Going live still needs the settings
 *   Check -> Save draft -> Activate flow, which is admin only.
 * - "Delete" is an archive: history is kept.
 */
export interface PresetRepo {
  nextId(): Promise<number>;
  insert(p: IndicatorPreset): Promise<void>;
  get(id: string): Promise<IndicatorPreset | null>;
  list(): Promise<IndicatorPreset[]>;               // every stored custom preset, every version
  patchStatus(id: string, status: IndicatorPreset["status"]): Promise<void>;
}

export class PresetService {
  constructor(private readonly repo: PresetRepo, private readonly clock: () => number = Date.now) {}
  private iso(): string { return new Date(this.clock()).toISOString(); }

  builtins(): IndicatorPreset[] { return BUILTIN_PRESETS.map(clonePreset); }

  async listCustom(includeArchived = false): Promise<IndicatorPreset[]> {
    const all = await this.repo.list();
    return all.filter((p) => includeArchived || p.status === "saved").sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  async get(id: string): Promise<IndicatorPreset | null> {
    return getBuiltinPreset(id) ?? (await this.repo.get(id));
  }

  /** Saves a new custom preset, or the next version if this name already exists. */
  async saveCustom(input: { name: unknown; description?: unknown; settings: unknown; required?: unknown }, by: string): Promise<IndicatorPreset> {
    const checked = validatePresetSettings(input.settings);
    const errors = [...validatePresetName(input.name), ...validatePresetDescription(input.description), ...checked.errors];
    if (input.required !== undefined && !(Array.isArray(input.required) && input.required.every((k) => typeof k === "string" && k in checked.settings.toggles))) errors.push("required must be a list of indicator names");
    if (errors.length) throw new SettingsError("invalid", "Preset is not valid", errors);
    const name = (input.name as string).trim();
    if (BUILTIN_PRESETS.some((b) => b.name.toLowerCase() === name.toLowerCase())) throw new SettingsError("conflict", "That name is used by a built-in preset");
    const same = (await this.repo.list()).filter((p) => p.name.toLowerCase() === name.toLowerCase());
    const p: IndicatorPreset = {
      id: `custom-${await this.repo.nextId()}`, name,
      description: typeof input.description === "string" ? input.description.trim() : "",
      version: same.reduce((m, x) => Math.max(m, x.version), 0) + 1,
      createdBy: by, createdAt: this.iso(), status: "saved",
      settings: checked.settings, required: (input.required as IndicatorPreset["required"] | undefined) ?? [],
    };
    await this.repo.insert(p);
    return clonePreset(p);
  }

  /** Copies any preset (built-in or custom) into a new custom preset. The source is untouched. */
  async duplicate(id: string, newName: unknown, by: string): Promise<IndicatorPreset> {
    const src = await this.get(id);
    if (!src) throw new SettingsError("not_found", `Preset ${id} does not exist`);
    const name = typeof newName === "string" && newName.trim() ? newName : `Copy of ${src.name}`.slice(0, 60);
    return this.saveCustom({ name, description: src.description, settings: src.settings, required: src.required }, by);
  }

  async archive(id: string): Promise<IndicatorPreset> {
    if (getBuiltinPreset(id)) throw new SettingsError("conflict", "Built-in presets cannot be archived");
    const p = await this.repo.get(id);
    if (!p) throw new SettingsError("not_found", `Preset ${id} does not exist`);
    await this.repo.patchStatus(id, "archived");
    return { ...p, status: "archived" };
  }
}

export class MemoryPresetRepo implements PresetRepo {
  private rows = new Map<string, IndicatorPreset>();
  private seq = 0;
  async nextId(): Promise<number> { return ++this.seq; }
  async insert(p: IndicatorPreset): Promise<void> { this.rows.set(p.id, structuredClone(p)); }
  async get(id: string): Promise<IndicatorPreset | null> { const r = this.rows.get(id); return r ? structuredClone(r) : null; }
  async list(): Promise<IndicatorPreset[]> { return [...this.rows.values()].map((r) => structuredClone(r)); }
  async patchStatus(id: string, status: IndicatorPreset["status"]): Promise<void> { const r = this.rows.get(id); if (r) r.status = status; }
}

type Row = Omit<IndicatorPreset, "id"> & { _id: string };
const toPreset = (d: Row): IndicatorPreset => { const { _id, ...rest } = d; return { id: _id, ...rest }; };

/** MongoDB backend. Own collections, separate from signals and engine settings. */
export class MongoPresetRepo implements PresetRepo {
  constructor(private readonly db: Db) {}
  private rows = () => this.db.collection<Row>("engine_presets");
  private meta = () => this.db.collection<{ _id: string; seq: number }>("engine_settings_meta");
  async nextId(): Promise<number> {
    const d = await this.meta().findOneAndUpdate({ _id: "preset_id" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
    if (!d) throw new Error("Could not allocate a preset id");
    return d.seq;
  }
  async insert(p: IndicatorPreset): Promise<void> { const { id, ...rest } = p; await this.rows().insertOne({ _id: id, ...rest }); }
  async get(id: string): Promise<IndicatorPreset | null> { const d = await this.rows().findOne({ _id: id }); return d ? toPreset(d) : null; }
  async list(): Promise<IndicatorPreset[]> { return (await this.rows().find().toArray()).map(toPreset); }
  async patchStatus(id: string, status: IndicatorPreset["status"]): Promise<void> { await this.rows().updateOne({ _id: id }, { $set: { status } }); }
}
