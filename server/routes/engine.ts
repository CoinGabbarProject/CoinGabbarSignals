import { Router } from "express";
import type { Request, Response } from "express";
import type { Timeframe } from "../../shared/market.js";
import type { FinalSignal } from "../models/signal.js";
import { SYMBOL_RE } from "../config/env.js";
import { requireAuth, requireAdmin } from "../middleware/requireAuth.js";
import { EngineBusyError, SignalNotOpenError } from "../engine/scanner.js";
import type { EngineService } from "../engine/scanner.js";
import type { SignalFilterStatus, SignalStore } from "../engine/store.js";

const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "30m", "1H", "4H", "1D"];
const DIRECTIONS: readonly FinalSignal["direction"][] = ["LONG", "SHORT", "WAIT", "NO_TRADE"];
const HISTORY_STATUSES: readonly SignalFilterStatus[] = ["ACTIVE", "CANCELLED", "EXPIRED"];
const MAX_SCAN_SYMBOLS = 100;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const one = (v: unknown): string | undefined => (typeof v === "string" ? v.trim() : undefined);
const oneOf = <T extends string>(list: readonly T[], v: string): T | undefined => list.find((x) => x === v);

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** ?symbol=&limit= shared by both list endpoints. Empty values are treated as "not given". */
function parseCommon(q: Request["query"]): Parsed<{ symbol?: string; limit: number }> {
  const rawSymbol = one(q["symbol"]);
  let symbol: string | undefined;
  if (rawSymbol) {
    symbol = rawSymbol.toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return { ok: false, error: "Invalid symbol" };
  }
  const rawLimit = one(q["limit"]);
  let limit = 50;
  if (rawLimit) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1 || n > 100) return { ok: false, error: "limit must be an integer from 1 to 100" };
    limit = n;
  }
  return symbol === undefined ? { ok: true, value: { limit } } : { ok: true, value: { symbol, limit } };
}

function parseScanBody(body: unknown): Parsed<{ symbols?: string[]; timeframe?: Timeframe }> {
  if (body === undefined || body === null) return { ok: true, value: {} };
  if (!isRecord(body)) return { ok: false, error: "Body must be a JSON object" };
  if (Object.keys(body).some((k) => k !== "symbols" && k !== "timeframe")) return { ok: false, error: "Only symbols and timeframe are allowed" };

  const out: { symbols?: string[]; timeframe?: Timeframe } = {};
  if (body["symbols"] !== undefined) {
    const raw = body["symbols"];
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_SCAN_SYMBOLS) return { ok: false, error: `symbols must be an array of 1-${MAX_SCAN_SYMBOLS} items` };
    const symbols = raw.map((s) => (typeof s === "string" ? s.trim().toUpperCase() : ""));
    if (symbols.some((s) => !SYMBOL_RE.test(s))) return { ok: false, error: "symbols contains an invalid symbol" };
    out.symbols = [...new Set(symbols)];
  }
  if (body["timeframe"] !== undefined) {
    const tf = typeof body["timeframe"] === "string" ? oneOf(TIMEFRAMES, body["timeframe"]) : undefined;
    if (!tf) return { ok: false, error: `timeframe must be one of ${TIMEFRAMES.join(", ")}` };
    out.timeframe = tf;
  }
  return { ok: true, value: out };
}

const bad = (res: Response, error: string): void => { res.status(400).json({ error }); };

/**
 * Routes mounted under /api/v1 (see API.md):
 *   GET  /engine/signals          login  - latest result per symbol+timeframe
 *   GET  /engine/signals/history  login  - emitted LONG/SHORT signals
 *   GET  /engine/status           admin  - scheduler state + last run
 *   POST /engine/scan             admin  - run a scan now (409 if one is already running)
 */
export function createEngineRouter(engine: EngineService, store: SignalStore): Router {
  const router = Router();

  router.get("/engine/signals", requireAuth, async (req, res) => {
    const common = parseCommon(req.query);
    if (!common.ok) return bad(res, common.error);
    const rawDir = one(req.query["direction"]);
    const direction = rawDir ? oneOf(DIRECTIONS, rawDir.toUpperCase()) : undefined;
    if (rawDir && !direction) return bad(res, `direction must be one of ${DIRECTIONS.join(", ")}`);

    try {
      const signals = await store.listLatest({ ...common.value, ...(direction ? { direction } : {}) });
      res.json({ success: true, count: signals.length, signals });
    } catch (err) {
      console.error("engine signals error:", err);
      res.status(500).json({ error: "Could not load signals" });
    }
  });

  router.get("/engine/signals/history", requireAuth, async (req, res) => {
    const common = parseCommon(req.query);
    if (!common.ok) return bad(res, common.error);
    const rawStatus = one(req.query["status"]);
    const status = rawStatus ? oneOf(HISTORY_STATUSES, rawStatus.toUpperCase()) : undefined;
    if (rawStatus && !status) return bad(res, `status must be one of ${HISTORY_STATUSES.join(", ")}`);

    try {
      const signals = await store.listHistory({ ...common.value, ...(status ? { status } : {}) });
      res.json({ success: true, count: signals.length, signals });
    } catch (err) {
      console.error("engine history error:", err);
      res.status(500).json({ error: "Could not load signal history" });
    }
  });

  router.get("/engine/status", requireAuth, requireAdmin, async (_req, res) => {
    try {
      res.json({ success: true, ...(await engine.status()) });
    } catch (err) {
      console.error("engine status error:", err);
      res.status(500).json({ error: "Could not load engine status" });
    }
  });

  router.post("/engine/signals/:id/exit", requireAuth, requireAdmin, async (req, res) => {
    const id = String(req.params["id"] ?? "").trim();
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return bad(res, "Invalid signal id");
    try {
      res.json({ success: true, ...(await engine.exitSignal(id)) });
    } catch (err) {
      if (err instanceof SignalNotOpenError) {
        res.status(404).json({ error: "Signal not found or already closed" });
        return;
      }
      console.error("engine exit error:", err);
      res.status(500).json({ error: "Could not exit signal" });
    }
  });

  router.post("/engine/scan", requireAuth, requireAdmin, async (req, res) => {
    const body = parseScanBody(req.body);
    if (!body.ok) return bad(res, body.error);

    try {
      const summary = await engine.runScan(body.value);
      res.json({ success: true, summary });
    } catch (err) {
      if (err instanceof EngineBusyError) {
        res.status(409).json({ error: "A scan is already running" });
        return;
      }
      console.error("engine scan error:", err);
      res.status(500).json({ error: "Scan failed" });
    }
  });

  return router;
}
