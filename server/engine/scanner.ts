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

const MAX_OPEN_PER_DIRECTION = 3;

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
async function guardEntry(signal: FinalSignal, tf: Timeframe, deps: EngineDeps, now: number, btc: 1 | -1 | 0): Promise<FinalSignal> {
  if (signal.direction !== "LONG" && signal.direction !== "SHORT") return signal;
  let reason: string | null = null;
  if (btc !== 0 && signal.symbol !== "BTCUSDT" && (signal.direction === "LONG" ? -1 : 1) === btc) {
    reason = `BTC trend is against this ${signal.direction}`;
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

/** Fetch everything for one symbol and build the signal. Primary-candle failure yields a NO_TRADE/UNAVAILABLE signal. */
export async function buildForSymbol(symbol: string, tf: Timeframe, s: ScanSettings, deps: EngineDeps, now: number, btc: 1 | -1 | 0 = 0): Promise<{ signal: FinalSignal; error?: string }> {
  const confTf = CONFIRMATION_TF[tf];
  const optional = async <T>(p: Promise<T> | null): Promise<T | null> => { try { return p ? await p : null; } catch { return null; } };
  const primary = deps.market.getCandles(symbol, tf, s.candleLimit, now);
  const [pr, confirmation, ticker, derivatives, news] = await Promise.all([
    primary.then((c): Candle[] | Error => c, (e: unknown): Candle[] | Error => (e instanceof Error ? e : new Error(String(e)))),
    optional(confTf ? deps.market.getCandles(symbol, confTf, s.candleLimit, now) : null),
    optional(deps.market.getTicker24h(symbol)),
    optional(deps.market.getDerivatives(symbol, tf)),
    optional(deps.news ? deps.news(symbol) : null),
  ]);
  const failed = pr instanceof Error ? pr.message : undefined;
  const signal = buildSignal({
    symbol, exchange: deps.exchange ?? "binance", marketType: "spot",
    timeframe: { primary: tf, confirmation: confTf ?? "none", execution: EXECUTION_TF[tf] },
    candles: pr instanceof Error ? [] : pr,
    confirmation, change24hPct: ticker?.change24hPct ?? null, volume24h: ticker?.volume24h ?? null,
    derivatives, news,
  }, { now, config: { minScore: s.minScore } });
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
      const results = await pool(symbols, this.settings.concurrency, async (symbol): Promise<SymbolResult> => {
        const now = this.now;
        try {
          const { signal, error } = await buildForSymbol(symbol, tf, this.settings, this.deps, now);
          const outcome = await persistSignal(signal, this.deps.store, now);
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
