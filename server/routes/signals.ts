import { Router } from "express";
import { z } from "zod";
import { getMongoDB } from "../db/mongodb.js";
import { requireAuth, requireAdmin } from "../middleware/requireAuth.js";

const router = Router();

const SIDES = ["LONG", "SHORT", "NO_TRADE"] as const;
const STATUSES = ["ACTIVE", "CLOSED", "CANCELLED", "EXPIRED"] as const;
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
    if ((STATUSES as readonly string[]).includes(status)) {
      filter.status = status;
    }

    const symbol = String(req.query.symbol || "").toUpperCase().trim();
    if (symbol) {
      filter.symbol = symbol;
    }

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 50, 1),
      100
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
          symbol: d.symbol,
          side: d.direction,
          status: d.status,
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
          createdAt: Number.isFinite(created) ? created : Date.now(),
          ...(closed !== undefined && Number.isFinite(closed) ? { closedAt: closed } : {}),
          ...(d?.outcome
            ? { exit: d.outcome.exit, outcomeClosed: Boolean(d.outcome.closed) }
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

export default router;
