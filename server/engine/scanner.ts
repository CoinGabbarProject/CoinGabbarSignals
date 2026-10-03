import type { Candle, Timeframe } from "../../shared/market.js";
import type { NewsInput } from "../../shared/scoring.js";
import { buildSignal } from "./signalBuilder.js";
import { trackOutcomes } from "./tracker.js";
import { buildSignal } from "./signalBuilder.js";
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

/** Fetch everything for one symbol and build the signal. Primary-candle failure yields a NO_TRADE/UNAVAILABLE signal. */
export async function buildForSymbol(symbol: string, tf: Timeframe, s: ScanSettings, deps: EngineDeps, now: number): Promise<{ signal: FinalSignal; error?: string }> {
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
  const atIso = new Date(now).toISOString();
  const active = await store.findActive(signal.symbol, signal.timeframe.primary);
  if (signal.direction !== "LONG" && signal.direction !== "SHORT") return "not_emitted";
  for (const a of active) {
    // a running trade is never cancelled: it ends only by TP or SL
    if (a.direction !== signal.direction && !a.entered) await store.setStatus(a.id, "CANCELLED", atIso);
  }
  if (active.some((a) => a.direction === signal.direction)) return "duplicate";
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
      try {
        await trackOutcomes({ market: this.deps.market, store: this.deps.store, now: this.deps.now, log: this.log });
      } catch (e) { this.log.error(`[scan] outcome tracking failed: ${errMsg(e)}`); }
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

  stop(): void {
    this.intervalMs = 0;
    this.nextRunAt = null;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
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
