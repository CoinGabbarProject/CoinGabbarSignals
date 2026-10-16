import { Router } from "express";
import type { Response } from "express";
import { requireAuth, requireAdmin } from "../middleware/requireAuth.js";
import { DEFAULT_ENGINE_SETTINGS, ENGINE_SETTINGS_SCHEMA } from "../../shared/engineConfig.js";
import { SettingsError } from "../engine/settingsStore.js";
import type { PresetRef, SettingsService } from "../engine/settingsStore.js";
import type { PresetService } from "../engine/presetStore.js";
import { backtestCaveats, diffSettings, presetWarnings, summarizeSettings, validatePresetSettings } from "../../shared/presets.js";

/**
 * Admin API for engine settings (indicator periods and on/off switches).
 * Mounted under /api/v1. Every route needs a login with the admin role.
 *
 *   GET  /engine/settings                   active version, defaults, recent versions
 *   GET  /engine/settings/:version          one version
 *   POST /engine/settings/validate          check settings, saves nothing
 *   POST /engine/settings/drafts            save a new draft (does not change live signals)
 *   POST /engine/settings/:version/activate make a version live
 *   POST /engine/settings/rollback          go back to the previously active version
 *   POST /engine/settings/reset             back to built-in defaults
 *
 * Presets (only when a PresetService is given). None of these change the live engine:
 *   GET  /engine/presets                    built-in + custom presets
 *   POST /engine/presets                    save a custom preset (new name, or next version of a name)
 *   POST /engine/presets/summary            indicator summary + warnings for a form state
 *   POST /engine/presets/compare            which indicators differ between two presets
 *   POST /engine/presets/:id/duplicate      copy any preset into a new custom preset
 *   POST /engine/presets/:id/archive        hide a custom preset (history is kept)
 *
 * POST is used for every change because the CORS list only allows GET, POST, PATCH and DELETE.
 */
export function createSettingsRouter(service: SettingsService, presets?: PresetService): Router {
  const router = Router();
  const guard = [requireAuth, requireAdmin];

  const fail = (res: Response, err: unknown): void => {
    if (err instanceof SettingsError) {
      const status = err.code === "invalid" ? 400 : err.code === "not_found" ? 404 : 409;
      res.status(status).json({ error: err.message, ...(err.details.length ? { details: err.details } : {}) });
      return;
    }
    console.error("settings error:", err);
    res.status(500).json({ error: "Settings request failed" });
  };
  const who = (req: { user?: { email: string } }): string => req.user?.email ?? "unknown";
  const parseVersion = (raw: unknown): number | null => {
    const n = Number(raw);
    return typeof raw === "string" && /^\d{1,9}$/.test(raw) && Number.isSafeInteger(n) && n > 0 ? n : null;
  };

  router.get("/engine/settings", ...guard, async (_req, res) => {
    try {
      const [active, versions] = await Promise.all([service.getActive(), service.list(50)]);
      res.json({ success: true, schema: ENGINE_SETTINGS_SCHEMA, defaults: DEFAULT_ENGINE_SETTINGS, active, versions });
    } catch (e) { fail(res, e); }
  });

  router.post("/engine/settings/validate", ...guard, (req, res) => {
    const body = (req.body ?? {}) as { settings?: unknown };
    const r = service.check(body.settings);
    res.status(r.ok ? 200 : 400).json({ success: r.ok, errors: r.errors, settings: r.settings });
  });

  router.post("/engine/settings/drafts", ...guard, async (req, res) => {
    try {
            const body = (req.body ?? {}) as { settings?: unknown; note?: unknown; presetId?: unknown };
      let ref: PresetRef | undefined;
      if (body.presetId !== undefined) {
        const preset = typeof body.presetId === "string" && presets ? await presets.get(body.presetId) : null;
        if (!preset) throw new SettingsError("invalid", "Settings are not valid", ["presetId does not match a known preset"]);
        const checked = service.check(body.settings);
        ref = {
          id: preset.id, name: preset.name, version: preset.version,
          modified: !diffSettings(preset.settings, checked.settings).same,
          requiredData: preset.required.filter((k): k is "derivatives" | "orderBook" => (k === "derivatives" || k === "orderBook") && checked.settings.toggles[k]),
        };
      }
      const saved = await service.createDraft(body.settings, body.note, who(req), ref);
      res.status(201).json({ success: true, version: saved });
    } catch (e) { fail(res, e); }
  });

  router.post("/engine/settings/rollback", ...guard, async (req, res) => {
    try { res.json({ success: true, version: await service.rollback(who(req)) }); } catch (e) { fail(res, e); }
  });

  router.post("/engine/settings/reset", ...guard, async (_req, res) => {
    try { res.json({ success: true, deactivated: await service.reset(), usingDefaults: true }); } catch (e) { fail(res, e); }
  });

  router.post("/engine/settings/:version/activate", ...guard, async (req, res) => {
    const version = parseVersion(req.params["version"]);
    if (version === null) { res.status(400).json({ error: "version must be a positive whole number" }); return; }
    try { res.json({ success: true, version: await service.activate(version, who(req)) }); } catch (e) { fail(res, e); }
  });

  router.get("/engine/settings/:version", ...guard, async (req, res) => {
    const version = parseVersion(req.params["version"]);
    if (version === null) { res.status(400).json({ error: "version must be a positive whole number" }); return; }
    try {
      const v = await service.get(version);
      if (!v) { res.status(404).json({ error: `Version ${version} does not exist` }); return; }
      res.json({ success: true, version: v });
    } catch (e) { fail(res, e); }
  });

    if (presets) {
    router.get("/engine/presets", ...guard, async (_req, res) => {
      try { res.json({ success: true, builtin: presets.builtins(), custom: await presets.listCustom(true) }); } catch (e) { fail(res, e); }
    });
    router.post("/engine/presets", ...guard, async (req, res) => {
      try {
        const b = (req.body ?? {}) as { name?: unknown; description?: unknown; settings?: unknown; required?: unknown };
        res.status(201).json({ success: true, preset: await presets.saveCustom({ name: b.name, description: b.description, settings: b.settings, required: b.required }, who(req)) });
      } catch (e) { fail(res, e); }
    });
    router.post("/engine/presets/summary", ...guard, async (req, res) => {
      const b = (req.body ?? {}) as { settings?: unknown; presetId?: unknown };
      const checked = validatePresetSettings(b.settings ?? {});
      const preset = typeof b.presetId === "string" ? await presets.get(b.presetId).catch(() => null) : null;
      res.status(checked.ok ? 200 : 400).json({
        success: checked.ok, errors: checked.errors,
        summary: summarizeSettings(checked.settings),
        warnings: preset ? presetWarnings(preset, checked.settings) : presetWarnings({ name: "", required: [] }, checked.settings),
        backtestCaveats: backtestCaveats(checked.settings),
      });
    });
    router.post("/engine/presets/compare", ...guard, async (req, res) => {
      try {
        const b = (req.body ?? {}) as { a?: unknown; b?: unknown };
        const [pa, pb] = await Promise.all([typeof b.a === "string" ? presets.get(b.a) : null, typeof b.b === "string" ? presets.get(b.b) : null]);
        if (!pa || !pb) { res.status(404).json({ error: "Both presets must exist" }); return; }
        res.json({ success: true, a: { id: pa.id, name: pa.name }, b: { id: pb.id, name: pb.name }, diff: diffSettings(pa.settings, pb.settings) });
      } catch (e) { fail(res, e); }
    });
    router.post("/engine/presets/:id/duplicate", ...guard, async (req, res) => {
      try {
        const body = (req.body ?? {}) as { name?: unknown };
        res.status(201).json({ success: true, preset: await presets.duplicate(String(req.params["id"]), body.name, who(req)) });
      } catch (e) { fail(res, e); }
    });
    router.post("/engine/presets/:id/archive", ...guard, async (req, res) => {
      try { res.json({ success: true, preset: await presets.archive(String(req.params["id"])) }); } catch (e) { fail(res, e); }
    });
  }

  return router;
}
