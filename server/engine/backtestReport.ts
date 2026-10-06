import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { Request } from "express";
import type { Candle, Timeframe } from "../../shared/market.js";
import type { ScanConfig } from "../config/env.js";
import { SYMBOL_RE } from "../config/env.js";
import { DEFAULT_BACKTEST_OPTIONS, runBacktest } from "./backtest.js";
import type { BacktestOptions, BacktestResult, BacktestTrade } from "./backtest.js";
import { DEFAULT_HISTORY_CONFIG, barsForDays, fetchHistory, loadSymbolHistory, WARMUP } from "./backtestData.js";
import type { SymbolHistory } from "./backtestData.js";

/**
 * Backtest - part 3 of 3: statistics, text report and the /engine/backtest route.
 *
 *   /engine/backtest?key=BACKTEST_KEY&days=30&tf=1H&minScore=75
 * Optional: symbols=BTCUSDT,ETHUSDT  cost=0.1  hold=96  btc=1  cluster=3  format=json
 */

export interface Summary {
  n: number;
  wins: number;
  winPct: number;
  tp1Pct: number;
  avgR: number;
  totalR: number;
  profitFactor: number | null; // null = no losing trade
  avgBars: number;
}

export function summarize(trades: BacktestTrade[]): Summary {
  const n = trades.length;
  if (n === 0) return { n: 0, wins: 0, winPct: 0, tp1Pct: 0, avgR: 0, totalR: 0, profitFactor: null, avgBars: 0 };
  let wins = 0, tp1 = 0, totalR = 0, gain = 0, loss = 0, bars = 0;
  for (const t of trades) {
    if (t.r > 0) { wins++; gain += t.r; } else loss += -t.r;
    if (t.hits >= 1) tp1++;
    totalR += t.r;
    bars += t.bars;
  }
  return {
    n, wins, winPct: (wins / n) * 100, tp1Pct: (tp1 / n) * 100, avgR: totalR / n, totalR,
    profitFactor: loss > 0 ? gain / loss : null, avgBars: bars / n,
  };
}

/** Largest peak-to-trough fall of cumulative R, trades taken in exit order. */
export function maxDrawdownR(trades: BacktestTrade[]): number {
  let cum = 0, peak = 0, dd = 0;
  for (const t of [...trades].sort((a, b) => a.exitTime - b.exitTime)) {
    cum += t.r;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return dd;
}

/** Longest run of consecutive losing trades. */
export function maxLossStreak(trades: BacktestTrade[]): number {
  let cur = 0, best = 0;
  for (const t of [...trades].sort((a, b) => a.exitTime - b.exitTime)) {
    cur = t.r > 0 ? 0 : cur + 1;
    best = Math.max(best, cur);
  }
  return best;
}

export const SCORE_BUCKETS: readonly { label: string; min: number; max: number }[] = [
  { label: "<75", min: 0, max: 74.999 }, { label: "75-79", min: 75, max: 79.999 },
  { label: "80-84", min: 80, max: 84.999 }, { label: "85-89", min: 85, max: 89.999 },
  { label: "90+", min: 90, max: 1000 },
];

export interface Report {
  overall: Summary;
  maxDrawdownR: number;
  maxLossStreak: number;
  byDirection: { label: string; s: Summary }[];
  byScore: { label: string; s: Summary }[];
  bySymbol: { label: string; s: Summary }[];
  exits: Record<string, number>;
}

export function buildReport(trades: BacktestTrade[]): Report {
  const exits: Record<string, number> = {};
  for (const t of trades) {
    const key = t.reason === "SL" ? (t.hits > 0 ? `SL after TP${t.hits}` : "SL") : t.reason;
    exits[key] = (exits[key] ?? 0) + 1;
  }
  const symbols = [...new Set(trades.map((t) => t.symbol))];
  return {
    overall: summarize(trades),
    maxDrawdownR: maxDrawdownR(trades),
    maxLossStreak: maxLossStreak(trades),
    byDirection: (["LONG", "SHORT"] as const).map((d) => ({ label: d, s: summarize(trades.filter((t) => t.direction === d)) })),
    byScore: SCORE_BUCKETS.map((b) => ({ label: b.label, s: summarize(trades.filter((t) => t.score >= b.min && t.score <= b.max)) })).filter((x) => x.s.n > 0),
    bySymbol: symbols.map((sym) => ({ label: sym, s: summarize(trades.filter((t) => t.symbol === sym)) })).sort((a, b) => b.s.totalR - a.s.totalR),
    exits,
  };
}

const f = (n: number, d = 2): string => n.toFixed(d);
const sg = (n: number, d = 2): string => (n >= 0 ? "+" : "") + n.toFixed(d);
const pf = (v: number | null): string => (v === null ? "inf" : f(v));
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const pad = (s: string, w: number): string => s.padEnd(w);
const row = (label: string, s: Summary): string =>
  `${pad(label, 9)}${pad(String(s.n), 5)}${pad(f(s.winPct, 0) + "%", 6)}${pad(sg(s.avgR), 7)}${pad(sg(s.totalR, 1), 8)}${pf(s.profitFactor)}`;
const head = "          N    Win%  AvgR   TotalR  PF";

export function formatReport(res: BacktestResult, rep: Report, failed: string[]): string {
  const o = res.options;
  const L: string[] = [];
  L.push("BACKTEST REPORT");
  L.push(`Period    ${day(res.fromTime)} -> ${day(res.toTime)}  (${o.timeframe})`);
  L.push(`Coins     ${res.symbols.length}${failed.length ? `  (failed: ${failed.join(",")})` : ""}`);
  L.push(`Settings  minScore ${o.minScore} | cost ${o.costPct}% | hold ${o.maxHoldBars} bars | btcFilter ${o.btcFilter ? "on" : "off"} | cluster ${o.maxOpenPerDirection || "off"}`);
  L.push("");
  const s = rep.overall;
  if (s.n === 0) {
    L.push("No trades. Lower minScore or raise days.");
  } else {
    L.push(`Trades    ${s.n}   Wins ${s.wins} (${f(s.winPct, 1)}%)   TP1 hit ${f(s.tp1Pct, 0)}%`);
    L.push(`Avg R     ${sg(s.avgR, 3)} per trade   Total ${sg(s.totalR, 1)}R`);
    L.push(`Profit factor ${pf(s.profitFactor)}   Max drawdown ${f(rep.maxDrawdownR, 1)}R   Loss streak ${rep.maxLossStreak}`);
    L.push(`Avg hold  ${f(s.avgBars, 1)} bars`);
    L.push("");
    L.push("EXITS: " + Object.entries(rep.exits).map(([k, v]) => `${k} ${v}`).join(" | "));
    L.push("");
    L.push("BY DIRECTION"); L.push(head);
    for (const x of rep.byDirection) L.push(row(x.label, x.s));
    L.push(""); L.push("BY SCORE"); L.push(head);
    for (const x of rep.byScore) L.push(row(x.label, x.s));
    L.push(""); L.push("BY COIN (best first)"); L.push(head);
    for (const x of rep.bySymbol) L.push(row(x.label.replace("USDT", ""), x.s));
  }
  const k = res.skips;
  L.push("");
  L.push(`FILTERED: signals ${k.signals} | btc ${k.btcFilter} | no-entry ${k.noEntry} | bad-stop ${k.badStop} | cluster ${k.cluster} | open-at-end ${k.openAtEnd}`);
  L.push(`Decisions evaluated: ${res.decisions}`);
  L.push("");
  L.push("Not modelled: derivatives, order book, news, funding. Past results do not guarantee future results.");
  return L.join("\n");
}

const TFS: readonly Timeframe[] = ["1m", "5m", "15m", "30m", "1H", "4H", "1D"];
const one = (v: unknown): string | undefined => (typeof v === "string" ? v.trim() : undefined);

function num(raw: string | undefined, fallback: number, min: number, max: number): number | null {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function mapPool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T);
    }
  }));
  return out;
}

type Parsed = { ok: true; symbols: string[]; days: number; opts: BacktestOptions; json: boolean } | { ok: false; error: string };

function parseQuery(q: Request["query"], scan: ScanConfig): Parsed {
  const tfRaw = one(q["tf"]) ?? scan.timeframe;
  const tf = TFS.find((x) => x === tfRaw);
  if (!tf) return { ok: false, error: `tf must be one of ${TFS.join(", ")}` };
  const days = num(one(q["days"]), 30, 1, 200);
  const minScore = num(one(q["minScore"]), scan.minScore, 0, 100);
  const cost = num(one(q["cost"]), DEFAULT_BACKTEST_OPTIONS.costPct, 0, 2);
  const hold = num(one(q["hold"]), DEFAULT_BACKTEST_OPTIONS.maxHoldBars, 1, 500);
  const cluster = num(one(q["cluster"]), DEFAULT_BACKTEST_OPTIONS.maxOpenPerDirection, 0, 50);
  if (days === null) return { ok: false, error: "days must be 1-200" };
  if (minScore === null) return { ok: false, error: "minScore must be 0-100" };
  if (cost === null) return { ok: false, error: "cost must be 0-2 (percent)" };
  if (hold === null) return { ok: false, error: "hold must be 1-500" };
  if (cluster === null) return { ok: false, error: "cluster must be 0-50" };
  const top = num(one(q["top"]), 20, 1, 50);
  if (top === null) return { ok: false, error: "top must be 1-50" };
  const rawSyms = one(q["symbols"]);
  const symbols = rawSyms ? [...new Set(rawSyms.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))] : scan.symbols.slice(0, Math.trunc(top));
  if (symbols.length < 1 || symbols.length > 50 || symbols.some((s) => !SYMBOL_RE.test(s))) return { ok: false, error: "symbols: 1-50 valid symbols" };
  return {
    ok: true, symbols, days, json: one(q["format"]) === "json",
    opts: {
      timeframe: tf, testBars: barsForDays(days, tf), minScore, costPct: cost, maxHoldBars: Math.trunc(hold),
      btcFilter: one(q["btc"]) !== "0", maxOpenPerDirection: Math.trunc(cluster),
    },
  };
}

/** Mounted at /engine, so the full path is /engine/backtest. Needs the BACKTEST_KEY env variable. */
export function createBacktestRouter(scan: ScanConfig): Router {
  const router = Router();
  let running = false;

  router.get("/backtest", async (req, res) => {
    const key = process.env["BACKTEST_KEY"];
    if (!key) { res.status(404).type("text/plain").send("Backtest disabled. Set BACKTEST_KEY on the server."); return; }
    if (!safeEqual(one(req.query["key"]) ?? "", key)) { res.status(401).type("text/plain").send("Wrong key."); return; }
    const p = parseQuery(req.query, scan);
    if (!p.ok) { res.status(400).type("text/plain").send(p.error); return; }
    if (running) { res.status(409).type("text/plain").send("A backtest is already running. Try again in a minute."); return; }

    running = true;
    try {
      const now = Date.now();
      const cfg = DEFAULT_HISTORY_CONFIG;
      const failed: string[] = [];
      const loaded = await mapPool(p.symbols, 3, async (sym): Promise<SymbolHistory | null> => {
        try { return await loadSymbolHistory(sym, p.opts.timeframe, p.opts.testBars, now, cfg); }
        catch (e) { console.error("backtest load failed:", e instanceof Error ? e.message : e); failed.push(sym); return null; }
      });
      const histories = loaded.filter((h): h is SymbolHistory => h !== null && h.primary.length > 0);
      if (histories.length === 0) { res.status(502).type("text/plain").send("Could not load any history from OKX."); return; }

      let btc: Candle[] | null = null;
      if (p.opts.btcFilter) {
        btc = histories.find((h) => h.symbol === "BTCUSDT")?.primary ?? null;
        if (!btc) {
          try { btc = await fetchHistory("BTCUSDT", p.opts.timeframe, p.opts.testBars + WARMUP, now, cfg); }
          catch (e) { console.error("backtest btc load failed:", e instanceof Error ? e.message : e); }
        }
      }

      const result = await runBacktest(histories, btc, p.opts);
      const rep = buildReport(result.trades);
      if (p.json) { res.json({ success: true, failed, report: rep, skips: result.skips, trades: result.trades }); return; }
      res.type("text/plain; charset=utf-8").send(formatReport(result, rep, failed));
    } catch (err) {
      console.error("backtest error:", err);
      res.status(500).type("text/plain").send("Backtest failed. See server logs.");
    } finally {
      running = false;
    }
  });

  return router;
}
