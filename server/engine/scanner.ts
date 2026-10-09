import type { Candle, Timeframe } from "../../shared/market.js";
import type { NewsInput } from "../../shared/scoring.js";
import type { FinalSignal } from "../models/signal.js";
import { buildSignal } from "./signalBuilder.js";
import { calcIndicators } from "../../shared/indicators.js";
import { trackOutcomes } from "./tracker.js";
import { CONFIRMATION_TF, EXECUTION_TF } from "./marketData.js";
import type { MarketData } from "./marketData.js";
import type { ScanOutcome, ScanSummary, SignalStore, SymbolResult } from "./store.js";

export interface ScanSettings {
  symbols: string[];
  timeframe: Timeframe;
  minScore: number;
  concurrency: number;
  candleLimit: number;
}
export interface EngineDeps {
  market: MarketData;
  store: SignalStore;
  exchange?: string;
  /** Optional. Without a news provider the news part scores 0 and high-impact-news NO_TRADE can never fire. */
  news?: (symbol: string) => Promise<NewsInput | null>;
  now?: () => number;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export class EngineBusyError extends Error {
  constructor() { super("A scan is already running"); this.name = "EngineBusyError"; }
}

export class SignalNotOpenError extends Error {
  constructor() { super("Signal not found or already closed"); this.name = "SignalNotOpenError"; }
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const MAX_OPEN_PER_DIRECTION = Number(process.env.MAX_OPEN_PER_DIRECTION ?? "5");

// Score-weak exit: if a coin's fresh score stays below EXIT_WEAK_SCORE for EXIT_WEAK_SCANS scans in a row,
// its ACTIVE signal (TP1 not hit yet) is withdrawn (CANCELLED). Set EXIT_WEAK_SCORE=0 to turn off.
const WEAK_SCORE = Number(process.env.EXIT_WEAK_SCORE ?? 50);
const WEAK_SCANS = Math.max(1, Number(process.env.EXIT_WEAK_SCANS ?? 2));
const weakCount = new Map<string, number>();
async function exitIfWeak(signal: FinalSignal, store: SignalStore, now: number, log: Pick<Console, "info">): Promise<void> {
  if (!(WEAK_SCORE > 0)) return;
  const q = signal.dataQuality.status;
  if (q !== "FRESH" && q !== "PARTIAL") return; // a data failure must never cancel a live signal
  const key = `${signal.symbol}:${signal.timeframe.primary}`;
  if (signal.score.total >= WEAK_SCORE) { weakCount.delete(key); return; }
  const n = (weakCount.get(key) ?? 0) + 1;
  if (n < WEAK_SCANS) { weakCount.set(key, n); return; }
  weakCount.delete(key);
  const open = (await store.findActive(signal.symbol, signal.timeframe.primary)).filter((o) => o.status === "ACTIVE" && !o.outcome?.closed && !o.entered);
  for (const o of open) {
    await store.setStatus(o.id, "CANCELLED", new Date(now).toISOString());
    log.info(`[scan] ${o.symbol} ${o.direction}: score fell to ${signal.score.total} (< ${WEAK_SCORE}) for ${WEAK_SCANS} scans, signal withdrawn`);
  }
}
// Persist one signal at a time so the per-direction limit below cannot be raced by the worker pool.
let persistLock: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = persistLock.then(fn, fn);
  persistLock = run.catch(() => undefined);
  return run;
}

/** BTC trend on the scan timeframe: 1 = up, -1 = down, 0 = unclear or unavailable. */
async function btcBias(deps: EngineDeps, tf: Timeframe, s: ScanSettings, now: number): Promise<1 | -1 | 0> {
  try {
    const c = await deps.market.getCandles("BTCUSDT", tf, s.candleLimit, now);
    const ind = calcIndicators(c);
    const k = c[c.length - 1];
    if (!ind || !k) return 0;
    if (ind.ema20 > ind.ema50 && k.close > ind.ema50) return 1;
    if (ind.ema20 < ind.ema50 && k.close < ind.ema50) return -1;
    return 0;
  } catch {
    return 0;
  }
}

/** Downgrades a LONG/SHORT to WAIT when entering right now is not sensible (BTC against it, or price left the entry zone). */
async function guardEntry(input: FinalSignal, tf: Timeframe, deps: EngineDeps, now: number, btc: 1 | -1 | 0, minScore: number): Promise<FinalSignal> {
  if (input.direction !== "LONG" && input.direction !== "SHORT") return input;
  let signal = input;
  let reason: string | null = null;
    // BTC_FILTER: "strict" = alts trade only WITH the BTC trend (unclear BTC = no alt entries),
  // "true" = block only when BTC is against, "soft" = score penalty, "false" = off
  const btcMode = (process.env.BTC_FILTER ?? "strict").toLowerCase();
  const isAlt = signal.symbol !== "BTCUSDT";
  const against = btc !== 0 && isAlt && (signal.direction === "LONG" ? -1 : 1) === btc;
  if (btcMode === "strict" && isAlt && btc === 0) {
    reason = "BTC trend is unclear, altcoin entries are paused";
  } else if (against && (btcMode === "true" || btcMode === "strict")) {
    reason = `BTC trend is against this ${signal.direction}`;
  } else if (against && btcMode === "soft") {
    const penalty = Number(process.env.BTC_SOFT_PENALTY ?? "5");
    const total = Math.max(0, signal.score.total - penalty);
    signal = {
      ...signal,
      score: { ...signal.score, total },
      reasoning: { ...signal.reasoning, warnings: [...signal.reasoning.warnings, `BTC trend is against this ${signal.direction} (score -${penalty})`] },
    };
    if (total < minScore) reason = `Score ${total} fell below ${minScore} after the BTC-against penalty`;
  }
  if (reason === null) {
    try {
      const live = await deps.market.getCandles(signal.symbol, EXECUTION_TF[tf], 2, now, true);
      const price = live[live.length - 1]?.close;
      if (typeof price === "number" && Number.isFinite(price) && (price < signal.entry.min || price > signal.entry.max)) {
        reason = `Live price ${price} is outside the entry zone ${signal.entry.min}-${signal.entry.max}`;
      }
    } catch {
      /* live price unavailable: keep the signal */
    }
  }
  if (reason === null) return signal;
  return {
    ...signal,
    direction: "WAIT",
    status: "INACTIVE",
    entry: { ...signal.entry, trigger: `No entry: ${reason}` },
    stopLoss: { price: null, method: "NONE", reason },
    takeProfit: { tp1: null, tp2: null, tp3: null },
    riskReward: { tp1: 0, tp2: 0, tp3: 0, weighted: 0 },
    reasoning: { ...signal.reasoning, primaryReason: reason, invalidation: "No active setup" },
  };
}

// Daily candles barely change: cache per symbol for 30 min (higher-timeframe filter).
const htfCache = new Map<string, { at: number; c: Candle[] }>();
async function htfCandles(deps: EngineDeps, symbol: string, now: number): Promise<Candle[]> {
  const hit = htfCache.get(symbol);
  if (hit && now - hit.at < 30 * 60_000) return hit.c;
  const c = await deps.market.getCandles(symbol, "1D", 120, now);
  htfCache.set(symbol, { at: now, c });
  return c;
}

/** Fetch everything for one symbol and build the signal. */
export async function buildForSymbol(symbol: string, tf: Timeframe, s: ScanSettings, deps: EngineDeps, now: number, btc: 1 | -1 | 0 = 0): Promise<{ signal: FinalSignal; error?: string }> {
  const confTf = CONFIRMATION_TF[tf];
  const optional = async <T>(p: Promise<T> | null): Promise<T | null> => { try { return p ? await p : null; } catch { return null; } };
  const primary = deps.market.getCandles(symbol, tf, s.candleLimit, now);
  const htfOn = tf !== "4H" && tf !== "1D" && (process.env.HTF_FILTER ?? "true") !== "false";
  const [pr, confirmation, ticker, derivatives, news, htf] = await Promise.all([
    primary.then((c): Candle[] | Error => c, (e: unknown): Candle[] | Error => (e instanceof Error ? e : new Error(String(e)))),
    optional(confTf ? deps.market.getCandles(symbol, confTf, s.candleLimit, now) : null),
    optional(deps.market.getTicker24h(symbol)),
    optional(deps.market.getDerivatives(symbol, tf)),
    optional(deps.news ? deps.news(symbol) : null),
    optional(htfOn ? htfCandles(deps, symbol, now) : null),
  ]);
  const failed = pr instanceof Error ? pr.message : undefined;
  const built = buildSignal({
    symbol, exchange: deps.exchange ?? "okx", marketType: deps.market.marketTypeOf?.(symbol) ?? "swap",
    timeframe: { primary: tf, confirmation: confTf ?? "none", execution: EXECUTION_TF[tf] },
    candles: pr instanceof Error ? [] : pr,
    confirmation, change24hPct: ticker?.change24hPct ?? null, volume24h: ticker?.volume24h ?? null, htf,
    derivatives, news,
}, { now, config: { minScore: s.minScore } });
  const signal = await guardEntry(built, tf, deps, now, btc, s.minScore);
  return failed === undefined ? { signal } : { signal, error: failed };
}

/**
 * Persist rules:
 *  - latest result per symbol+timeframe is always saved
 *  - LONG/SHORT is inserted into history only if no ACTIVE signal of the same direction exists (no spam every scan)
 *  - an ACTIVE signal of the OPPOSITE direction is CANCELLED
 *  - an ACTIVE signal whose entry window has passed is EXPIRED
 *  - WAIT / NO_TRADE never cancel anything (a transient data failure must not wipe a live signal)
 * TP/SL hit tracking is NOT part of this step: ACTIVE means "entry window still open".
 */
export async function persistSignal(signal: FinalSignal, store: SignalStore, now: number): Promise<ScanOutcome> {
  await store.saveLatest(signal);
  if (signal.direction !== "LONG" && signal.direction !== "SHORT") return "not_emitted";
  // One signal at a time per pair + timeframe: nothing new until the open one is complete
  // (TP3 hit, SL hit, or entry window missed = EXPIRED).
  const open = await store.findActive(signal.symbol, signal.timeframe.primary);
if (open.length > 0) return "duplicate";
  // Cluster limit: correlated coins hit their stops together, so cap open signals per direction.
  const sameSide = (await store.listTrackable()).filter(
    (x) => x.direction === signal.direction && x.timeframe.primary === signal.timeframe.primary && !x.outcome?.closed,
  );
  if (sameSide.length >= MAX_OPEN_PER_DIRECTION) return "not_emitted";
  await store.insertSignal(signal);
  return "emitted";
}

export class EngineService {
  private scanning = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalMs = 0;
  private nextRunAt: number | null = null;

  constructor(private readonly deps: EngineDeps, private readonly settings: ScanSettings) {}

  get isScanning(): boolean { return this.scanning; }
  private get now(): number { return this.deps.now ? this.deps.now() : Date.now(); }
  private get log(): Pick<Console, "info" | "warn" | "error"> { return this.deps.log ?? console; }

  async runScan(opts: { symbols?: string[]; timeframe?: Timeframe } = {}): Promise<ScanSummary> {
    if (this.scanning) throw new EngineBusyError();
    this.scanning = true;
    try {
      const symbols = opts.symbols ?? this.settings.symbols;
      const tf = opts.timeframe ?? this.settings.timeframe;
      const startedAt = new Date(this.now).toISOString();
      try {
        await trackOutcomes({ market: this.deps.market, store: this.deps.store, now: this.deps.now, log: this.log });
      } catch (e) { this.log.error(`[scan] outcome tracking failed: ${errMsg(e)}`); }
      const btc = await btcBias(this.deps, tf, this.settings, this.now);
      const results = await pool(symbols, this.settings.concurrency, async (symbol): Promise<SymbolResult> => {
        const now = this.now;
        try {
          const { signal, error } = await buildForSymbol(symbol, tf, this.settings, this.deps, now, btc);
          const outcome = await serial(() => persistSignal(signal, this.deps.store, now));
          await exitIfWeak(signal, this.deps.store, now, this.log).catch((e: unknown) => this.log.error(`[scan] weak-exit check failed: ${errMsg(e)}`));
          return error === undefined
            ? { symbol, direction: signal.direction, score: signal.score.total, outcome }
            : { symbol, direction: signal.direction, score: signal.score.total, outcome: "error", error };
        } catch (e) {
          this.log.error(`[scan] ${symbol} failed: ${errMsg(e)}`);
          return { symbol, direction: "NO_TRADE", score: 0, outcome: "error", error: errMsg(e) };
        }
      });
      const summary: ScanSummary = {
        startedAt, finishedAt: new Date(this.now).toISOString(), timeframe: tf,
        scanned: symbols.length, emitted: results.filter((r) => r.outcome === "emitted").length,
        errors: results.filter((r) => r.outcome === "error").length, results,
      };
      try { await this.deps.store.recordRun(summary); } catch (e) { this.log.error(`[scan] could not record run: ${errMsg(e)}`); }
      this.log.info(`[scan] ${tf}: ${summary.scanned} scanned, ${summary.emitted} new signals, ${summary.errors} errors`);
      return summary;
    } finally {
      this.scanning = false;
    }
  }

  /**
   * Manual exit (admin button). ACTIVE (TP1 not hit yet) -> CANCELLED.
   * TP1_HIT / TP2_HIT -> closed at the live price, keeping its TP hits.
   */
  async exitSignal(id: string): Promise<{ id: string; symbol: string; status: string; exit: number | null }> {
    const s = (await this.deps.store.listTrackable()).find((x) => x.id === id);
    if (!s || s.outcome?.closed) throw new SignalNotOpenError();
    const atIso = new Date(this.now).toISOString();
    if (s.status === "ACTIVE") {
      await this.deps.store.setStatus(id, "CANCELLED", atIso);
      this.log.info(`[exit] ${s.symbol} ${s.direction}: signal withdrawn manually`);
      return { id, symbol: s.symbol, status: "CANCELLED", exit: null };
    }
    const exec = EXECUTION_TF[s.timeframe.primary as Timeframe];
    const candles = await this.deps.market.getCandles(s.symbol, exec, 2, this.now, true);
    const price = candles[candles.length - 1]?.close;
    if (typeof price !== "number" || !Number.isFinite(price)) throw new Error("Live price unavailable");
    const status = s.status === "TP2_HIT" ? "TP2_HIT" : "TP1_HIT";
    await this.deps.store.setOutcome(id, { status, exit: price, closed: true, hits: s.outcome?.hits ?? {} }, atIso);
    this.log.info(`[exit] ${s.symbol} ${s.direction}: closed manually at ${price} (${status})`);
    return { id, symbol: s.symbol, status, exit: price };
  }

  /** Runs one scan after `firstDelayMs`, then keeps scheduling the next one only after the previous finished. */
  start(intervalMs: number, firstDelayMs = 5000): void {
    if (this.timer || this.intervalMs > 0) return;
    this.intervalMs = intervalMs;
    this.schedule(firstDelayMs);
  }

  private schedule(delay: number): void {
    this.nextRunAt = Date.now() + delay;
    this.timer = setTimeout(() => {
      this.timer = null;
      void (async () => {
        try { await this.runScan(); } catch (e) { this.log.error(`[scan] scheduled run failed: ${errMsg(e)}`); }
        if (this.intervalMs > 0) this.schedule(this.intervalMs);
      })();
    }, delay);
    this.timer.unref();
  }

  private tracking = false;
  private trackTimer: ReturnType<typeof setInterval> | null = null;

  async track(): Promise<number> {
    if (this.tracking) return 0;
    this.tracking = true;
    try {
      return await trackOutcomes({ market: this.deps.market, store: this.deps.store, now: this.deps.now, log: this.log });
    } catch (e) {
      this.log.error(`[tracker] failed: ${errMsg(e)}`);
      return 0;
    } finally {
      this.tracking = false;
    }
  }

  /** TP/SL tracking runs on its own timer, independent of the scan. */
  startTracker(intervalMs = 60_000): void {
    if (this.trackTimer) return;
    void this.track();
    this.trackTimer = setInterval(() => { void this.track(); }, intervalMs);
    this.trackTimer.unref();
  }

  stop(): void {
    this.intervalMs = 0;
    this.nextRunAt = null;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.trackTimer) { clearInterval(this.trackTimer); this.trackTimer = null; }
  }

  async status(): Promise<{ autoScan: boolean; scanning: boolean; intervalMs: number; nextRunAt: string | null; symbols: string[]; timeframe: Timeframe; lastRun: ScanSummary | null }> {
    return {
      autoScan: this.intervalMs > 0, scanning: this.scanning, intervalMs: this.intervalMs,
      nextRunAt: this.nextRunAt ? new Date(this.nextRunAt).toISOString() : null,
      symbols: this.settings.symbols, timeframe: this.settings.timeframe,
      lastRun: await this.deps.store.lastRun(),
    };
  }
}
