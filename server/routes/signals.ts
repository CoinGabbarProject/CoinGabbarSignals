import { Router } from "express";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getMongoDB } from "../db/mongodb.js";
import { requireAuth, requireAdmin } from "../middleware/requireAuth.js";

const router = Router();

const SIDES = ["LONG", "SHORT", "NO_TRADE"] as const;
const STATUSES = ["ACTIVE", "CLOSED", "CANCELLED", "EXPIRED"] as const;
const FILTER_STATUSES = [...STATUSES, "TP1_HIT", "TP2_HIT", "TP3_HIT", "SL_HIT", "BE_HIT"] as const;
const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1H", "4H", "1D"] as const;

const signalSchema = z
  .strictObject({
    symbol: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .transform((s) => s.toUpperCase()),
    side: z.enum(SIDES),
    status: z.enum(STATUSES).default("ACTIVE"),
    timeframe: z.enum(TIMEFRAMES),
    score: z.number().min(0).max(100),
    entry: z.number().positive(),
    stop: z.number().positive(),
    targets: z.array(z.number().positive()).min(1).max(5),
    rationale: z.string().trim().max(2000).default(""),
  })
  .superRefine((s, ctx) => {
    if (s.side === "LONG") {
      if (!(s.stop < s.entry)) {
        ctx.addIssue({
          code: "custom",
          path: ["stop"],
          message: "LONG signal: stop must be below entry",
        });
      }
      if (!s.targets.every((t) => t > s.entry)) {
        ctx.addIssue({
          code: "custom",
          path: ["targets"],
          message: "LONG signal: all targets must be above entry",
        });
      }
    }

    if (s.side === "SHORT") {
      if (!(s.stop > s.entry)) {
        ctx.addIssue({
          code: "custom",
          path: ["stop"],
          message: "SHORT signal: stop must be above entry",
        });
      }
      if (!s.targets.every((t) => t < s.entry)) {
        ctx.addIssue({
          code: "custom",
          path: ["targets"],
          message: "SHORT signal: all targets must be below entry",
        });
      }
    }
  });

// GET /api/v1/signals  (login required)
// Optional query: ?status=ACTIVE&symbol=BTCUSDT&limit=50
router.get("/signals", async (req, res) => {
  try {
    const filter: Record<string, unknown> = {};

    const status = String(req.query.status || "").toUpperCase();
    if ((FILTER_STATUSES as readonly string[]).includes(status)) {
      filter.status = status;
    }

    const symbol = String(req.query.symbol || "").toUpperCase().trim();
    if (symbol) {
      filter.symbol = symbol;
    }

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 50, 1),
      2000
    );

    const db = getMongoDB();

    // 1) Manual / admin signals (legacy "signals" collection)
    // Old/manual signals are static test data, so they are hidden by default.
    // Set INCLUDE_MANUAL_SIGNALS=true on Render to show them again.
    const includeManual = ["1", "true", "yes"].includes(
      (process.env.INCLUDE_MANUAL_SIGNALS || "").toLowerCase(),
    );

    const legacyDocs = includeManual
      ? await db
          .collection("signals")
          .find(filter)
          .sort({ createdAt: -1 })
          .limit(limit)
          .toArray()
      : [];

    const legacy = legacyDocs.map(({ _id, ...rest }) => ({
      id: _id.toString(),
      ...rest,
    }));

    // 2) Auto-scanner signals ("engine_signals", FinalSignal shape) -> dashboard shape
    const engineFilter: Record<string, unknown> = {};
    if (filter.status) engineFilter.status = filter.status;
    if (filter.symbol) engineFilter.symbol = filter.symbol;

    let engine: Record<string, unknown>[] = [];
    try {
      const engineDocs = await db
        .collection("engine_signals")
        .find(engineFilter)
        .sort({ "timestamps.createdAt": -1 })
        .limit(limit)
        .toArray();

      engine = engineDocs.map((d: any) => {
        const created = Date.parse(d?.timestamps?.createdAt ?? "");
        const closed = d?.timestamps?.closedAt
          ? Date.parse(d.timestamps.closedAt)
          : undefined;

        return {
          id: String(d._id),
                    source: "engine",
          kept: Boolean(d.kept),
          symbol: d.symbol,
          side: d.direction,
          status: d.status,
          entered: Boolean(d.entered),
          timeframe: d?.timeframe?.primary ?? "",
          score: d?.score?.total ?? 0,
          entry: d?.entry?.ideal ?? null,
          entryMin: d?.entry?.min ?? null,
          entryMax: d?.entry?.max ?? null,
          stop: d?.stopLoss?.price ?? null,
          targets: [d?.takeProfit?.tp1, d?.takeProfit?.tp2, d?.takeProfit?.tp3].filter(
            (t) => typeof t === "number",
          ),
          rationale: d?.reasoning?.primaryReason ?? "",
          strategyVersion: d?.strategy?.version ?? null,
          settingsVersion: d?.strategy?.settingsVersion ?? null,
                    derivatives: d?.derivatives ?? {},
          smc: d?.smc ?? {},
          liquidation: d?.liquidation ?? {},
          scoreBreakdown: d?.score ?? {},
          confirmations: d?.reasoning?.confirmations ?? [],
          conflicts: d?.reasoning?.conflicts ?? [],
          warnings: d?.reasoning?.warnings ?? [],
          createdAt: Number.isFinite(created) ? created : Date.now(),
          ...(closed !== undefined && Number.isFinite(closed) ? { closedAt: closed } : {}),
          ...(d?.outcome
            ? {
                exit: d.outcome.exit,
                outcomeClosed: Boolean(d.outcome.closed),
                outcomeAt: Date.parse(d.outcome.at ?? ""),
                hits: d.outcome.hits ?? {},
                ...(typeof d.outcome.trailStop === "number" ? { trailStop: d.outcome.trailStop } : {}),
              }
            : {}),
        };
      });
    } catch (e) {
      console.error("engine_signals read error:", e);
    }

    // Newest first. Show full signal history (only de-duplicate by id).
    const seenIds = new Set<string>();

    const signals = [...legacy, ...engine]
      .sort((a: any, b: any) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
      .filter((s: any) => {
        const key = String(s.id);
        if (seenIds.has(key)) return false;
        seenIds.add(key);
        return true;
      })
      .slice(0, limit);

    return res.json({ success: true, count: signals.length, signals });
  } catch (error) {
    console.error("Signals list error:", error);
    return res.status(500).json({ error: "Could not load signals" });
  }
});

// POST /api/v1/signals  (admin only)
router.post("/signals", requireAuth, requireAdmin, async (req, res) => {
  try {
    const parsed = signalSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid signal data",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    }

    const doc = {
      ...parsed.data,
      createdAt: Date.now(),
      createdBy: req.user!.userId,
    };

    const result = await getMongoDB().collection("signals").insertOne({ ...doc });

    return res.status(201).json({
      success: true,
      signal: { id: result.insertedId.toString(), ...doc },
    });
  } catch (error) {
    console.error("Signal create error:", error);
    return res.status(500).json({ error: "Could not create signal" });
  }
});

const OPEN_STATUSES = ["ACTIVE", "TP1_HIT", "TP2_HIT"];

// finds a signal in engine_signals (string id) or legacy signals (ObjectId)
async function findSignalTarget(id: string) {
  const db = getMongoDB();
  const eng = await db.collection("engine_signals").findOne({ _id: id as any });
  if (eng) return { col: db.collection("engine_signals"), filter: { _id: id as any }, doc: eng };
  if (ObjectId.isValid(id)) {
    const oid = new ObjectId(id);
    const leg = await db.collection("signals").findOne({ _id: oid });
    if (leg) return { col: db.collection("signals"), filter: { _id: oid }, doc: leg };
  }
  return null;
}

// PATCH /api/v1/signals/:id/keep  body: { kept: true|false }  (admin)
router.patch("/signals/:id/keep", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const kept = req.body?.kept !== false;
    const t = await findSignalTarget(id);
    if (!t) return res.status(404).json({ error: "Signal not found" });
    await t.col.updateOne(t.filter, { $set: { kept, keptAt: kept ? Date.now() : null } });
    return res.json({ success: true, id, kept });
  } catch (error) {
    console.error("Signal keep error:", error);
    return res.status(500).json({ error: "Could not update signal" });
  }
});

// DELETE /api/v1/signals/:id  (admin) - kept signals are protected
router.delete("/signals/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const t = await findSignalTarget(id);
    if (!t) return res.status(404).json({ error: "Signal not found" });
    if ((t.doc as any).kept) {
      return res.status(409).json({ error: "Signal is kept. Unkeep it before deleting." });
    }
    await t.col.deleteOne(t.filter);
    return res.json({ success: true, id });
  } catch (error) {
    console.error("Signal delete error:", error);
    return res.status(500).json({ error: "Could not delete signal" });
  }
});

// POST /api/v1/signals/purge  (admin) - deletes every NOT-kept, closed signal
router.post("/signals/purge", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const db = getMongoDB();
    const q = { kept: { $ne: true }, status: { $nin: OPEN_STATUSES } };
    const a = await db.collection("engine_signals").deleteMany(q);
    const b = await db.collection("signals").deleteMany(q);
    return res.json({ success: true, deleted: a.deletedCount + b.deletedCount });
  } catch (error) {
    console.error("Signal purge error:", error);
    return res.status(500).json({ error: "Could not purge signals" });
  }
});

// GET /api/v1/admin/overview  (admin) - real document counts for the Database Overview panel
router.get("/admin/overview", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const db = getMongoDB();
    const t0 = Date.now();
    await db.command({ ping: 1 });
    const pingMs = Date.now() - t0;
    const names = ["signals", "engine_signals", "engine_latest", "engine_runs", "engine_settings", "users"];
    const collections = await Promise.all(
      names.map(async (name) => {
        try {
          return { name, count: await db.collection(name).estimatedDocumentCount(), ok: true };
        } catch {
          return { name, count: null, ok: false };
        }
      }),
    );
    return res.json({ success: true, pingMs, collections });
  } catch (error) {
    console.error("Admin overview error:", error);
    return res.status(500).json({ error: "Could not load database overview" });
  }
});

export default router;
