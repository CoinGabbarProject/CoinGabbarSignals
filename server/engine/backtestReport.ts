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

/** Seeded PRNG so confidence intervals are repeatable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Interval { lo: number; hi: number }

/** 95% bootstrap interval of the mean. null if fewer than 2 values. */
export function bootstrapMeanCI(values: readonly number[], iters = 2000, seed = 12345): Interval | null {
  const n = values.length;
  if (n < 2) return null;
  const rnd = mulberry32(seed);
  const means: number[] = [];
  for (let b = 0; b < iters; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[Math.floor(rnd() * n)] as number;
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return { lo: means[Math.floor(0.025 * iters)] as number, hi: means[Math.min(iters - 1, Math.floor(0.975 * iters))] as number };
}

export const MIN_TRADES_PER_SEGMENT = 30;
export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE";
export interface Segment { label: string; s: Summary; ci: Interval | null }
export interface Validation {
  split: Segment[]; // train, validation, test (chronological, by entry time)
  months: Segment[]; // calendar-month slices (a time proxy for regimes)
  baselineAll: Segment; // same run with minScore 0
  baselineRest: Segment; // trades of that run scoring below minScore
  verdict: Verdict;
  reason: string;
}

const segment = (label: string, trades: BacktestTrade[]): Segment =>
  ({ label, s: summarize(trades), ci: bootstrapMeanCI(trades.map((t) => t.r)) });

export function buildValidation(trades: BacktestTrade[], baselineTrades: BacktestTrade[], minScore: number): Validation {
  const sorted = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  const n = sorted.length, c1 = Math.floor(n * 0.6), c2 = Math.floor(n * 0.8);
  const train = segment("train 60%", sorted.slice(0, c1));
  const valid = segment("valid 20%", sorted.slice(c1, c2));
  const test = segment("test 20%", sorted.slice(c2));
  const byMonth = new Map<string, BacktestTrade[]>();
  for (const t of sorted) {
    const k = new Date(t.entryTime).toISOString().slice(0, 7);
    const a = byMonth.get(k);
    if (a) a.push(t); else byMonth.set(k, [t]);
  }
  const months = [...byMonth.entries()].map(([k, v]) => segment(k, v));
  const baselineAll = segment("all signals", baselineTrades);
  const baselineRest = segment(`score<${minScore}`, baselineTrades.filter((t) => t.score < minScore));
  const M = MIN_TRADES_PER_SEGMENT;
  let verdict: Verdict, reason: string;
  if (valid.s.n < M || test.s.n < M) {
    verdict = "INCONCLUSIVE"; reason = `need >= ${M} trades in validation and in test (have ${valid.s.n} / ${test.s.n}); use more days or coins`;
  } else if (!test.ci) {
    verdict = "INCONCLUSIVE"; reason = "test interval not computable";
  } else if (test.ci.hi < 0) {
    verdict = "FAIL"; reason = "test avg R is negative with 95% confidence";
  } else if (test.ci.lo > 0 && valid.s.avgR > 0 && (baselineRest.s.n < M || test.s.avgR > baselineRest.s.avgR)) {
    verdict = "PASS"; reason = "test 95% interval is above 0, validation is positive, and the score beats the low-score baseline";
  } else {
    verdict = "INCONCLUSIVE"; reason = "test 95% interval includes 0, or validation / baseline disagree";
  }
  return { split: [train, valid, test], months, baselineAll, baselineRest, verdict, reason };
}

const segRow = (x: Segment): string =>
  `${x.label.padEnd(12)}${String(x.s.n).padEnd(5)}${((x.s.avgR >= 0 ? "+" : "") + x.s.avgR.toFixed(3)).padEnd(9)}${x.ci ? `[${x.ci.lo >= 0 ? "+" : ""}${x.ci.lo.toFixed(2)}, ${x.ci.hi >= 0 ? "+" : ""}${x.ci.hi.toFixed(2)}]` : "n/a"}`;

export function formatValidation(v: Validation): string {
  const L: string[] = ["VALIDATION (chronological, by entry time)", "            N    AvgR     95% CI of AvgR"];
  for (const x of v.split) L.push(segRow(x));
  L.push("", "BASELINES (same run, minScore 0)");
  L.push(segRow(v.baselineAll), segRow(v.baselineRest));
  L.push("", "BY MONTH (time slices, not true market regimes)");
  for (const x of v.months) L.push(segRow(x));
  L.push("", `VERDICT: ${v.verdict} - ${v.reason}`);
  L.push("Notes: use train/valid to choose settings and look at test once. Trades overlap in time, so the intervals are optimistic. No regime tags exist in the stored trades.");
  return L.join("\n");
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
    const key = t.reason === "SL" ? (t.hits > 0 ? `SL after TP${t.hits}` : "SL") : t.reason === "TRAIL" ? `Trail after TP${t.hits}` : t.reason;
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
  L.push(`Settings  minScore ${o.minScore} | cost ${o.costPct}% | hold ${o.maxHoldBars} bars | btcFilter ${o.btcFilter ? "on" : "off"} | cluster ${o.maxOpenPerDirection || "off"} | stop ${o.stopMode ?? "fixed"}${(o.trailPct ?? 0) > 0 ? ` trail ${o.trailPct}%` : ""} | funding ${(o.fundingPctPer8h ?? 0) > 0 ? `${o.fundingPctPer8h}%/8h (assumed)` : "off"}`);
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
    L.push("PARITY WITH THE LIVE ENGINE");
  L.push(`  stop: ${o.stopMode === "staged" ? "staged (entry after TP1, TP1 after TP2" + ((o.trailPct ?? 0) > 0 ? `, ${o.trailPct}% trail)` : ", no % trail)") : "fixed; the live tracker moves it after TP1/TP2 when TRAILING_STOP is on (use stop=staged)"}`);
  L.push(`  max open per direction: ${o.maxOpenPerDirection || "no limit"} here; live uses MAX_OPEN_PER_DIRECTION (default 5)`);
  L.push("  not replayed: derivatives, liquidations, order book, news, daily HTF filter, exit-if-weak rule, live-price entry check");
  L.push("  fills: next-candle open inside the entry zone; the live tracker counts any touch of the zone");
  L.push("Past results do not guarantee future results.");
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
    const trail = num(one(q["trail"]), 0, 0, 10);
  const funding = num(one(q["funding"]), 0, 0, 1);
  if (trail === null) return { ok: false, error: "trail must be 0-10 (percent)" };
  if (funding === null) return { ok: false, error: "funding must be 0-1 (percent per 8h)" };
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
      stopMode: one(q["stop"]) === "staged" ? "staged" : "fixed", trailPct: trail, fundingPctPer8h: funding,
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
      const baseline = await runBacktest(histories, btc, { ...p.opts, minScore: 0 });
      const validation = buildValidation(result.trades, baseline.trades, p.opts.minScore);
            if (p.json) { res.json({ success: true, failed, report: rep, validation, skips: result.skips, trades: result.trades }); return; }
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
