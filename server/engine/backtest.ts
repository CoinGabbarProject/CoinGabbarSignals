import type { Candle, Timeframe } from "../../shared/market.js";
import { buildSignal, DEFAULT_CONFIG } from "./signalBuilder.js";
import type { BuilderConfig } from "./signalBuilder.js";
import { EXECUTION_TF } from "./marketData.js";
import {
  TF_MS, WINDOW, biasAt, biasSeries, change24hPct, confirmationWindow, windowAt,
} from "./backtestData.js";
import type { Bias, SymbolHistory } from "./backtestData.js";

/**
 * Backtest - part 2 of 3: simulation core.
 *
 * Walks historical candles one closed candle at a time, runs the SAME buildSignal() the live
 * scanner uses on exactly the data the scanner would have had (no future candles), and plays every
 * LONG/SHORT forward to its outcome.
 *
 * Rules (kept equal to the live tracker where possible):
 *  - one trade per symbol at a time
 *  - entry = open of the candle after the signal, only if it lies inside the signal's entry zone
 *  - stop-loss is checked before targets inside the same candle (pessimistic, like the tracker)
 *  - the stop is NOT moved after TP1/TP2
 *  - position is closed in parts at TP1/TP2/TP3 using the builder's exitWeights; the rest exits at
 *    the stop, at TP3, or at the close of the last holding bar
 *  - fees + slippage are charged once per round trip as a percent of the entry price
 *
 * Not modelled: derivatives / order-book / news score parts (no historical data), intrabar
 * ordering below the chosen timeframe, partial fills, funding.
 */

export type ExitReason = "SL" | "TP3" | "TIMEOUT" | "END";

export interface BacktestOptions {
  timeframe: Timeframe;
  /** How many of the most recent closed candles to test (decision candles). */
  testBars: number;
  minScore: number;
  /** Round-trip fees + slippage, percent of entry price. */
  costPct: number;
  /** An entered trade is closed at market after this many candles (live tracker expires at 96). */
  maxHoldBars: number;
  /** Skip alt signals that go against the BTC trend, like the live scanner. */
  btcFilter: boolean;
  /** Max simultaneously open trades in one direction (0 = no limit), like the live scanner. */
  maxOpenPerDirection: number;
  /** Optional overrides of the signal builder's config (stop width, targets, ...). */
  config?: Partial<BuilderConfig>;
}

export const DEFAULT_BACKTEST_OPTIONS = {
  minScore: 75,
  costPct: 0.1,
  maxHoldBars: 96,
  btcFilter: true,
  maxOpenPerDirection: 3,
} as const;

export interface BacktestTrade {
  symbol: string;
  direction: "LONG" | "SHORT";
  score: number;
  decisionTime: number;
  entryTime: number;
  exitTime: number;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  /** Planned weighted reward:risk from the signal builder. */
  plannedRR: number;
  hits: 0 | 1 | 2 | 3;
  reason: ExitReason;
  bars: number;
  /** R before costs. */
  grossR: number;
  /** R after fees + slippage. This is the number every statistic uses. */
  r: number;
}

export interface BacktestSkips {
  /** LONG/SHORT signals the builder produced (before any filter below). */
  signals: number;
  btcFilter: number;
  noEntry: number;
  badStop: number;
  cluster: number;
  /** Trades still running when the data ends - excluded from the statistics. */
  openAtEnd: number;
}

export interface BacktestResult {
  options: BacktestOptions;
  symbols: string[];
  trades: BacktestTrade[];
  skips: BacktestSkips;
  /** Candles on which a decision was evaluated (summed over symbols). */
  decisions: number;
  fromTime: number;
  toTime: number;
}

export interface BacktestHooks {
  onProgress?: (symbolsDone: number, symbolsTotal: number) => void;
}

export interface TradeSim {
  exitIdx: number;
  exitPrice: number;
  hits: 0 | 1 | 2 | 3;
  reason: ExitReason;
  grossR: number;
  netR: number;
  bars: number;
}

/**
 * Plays one trade forward from candle index `from` (the entry candle). `side` 1 = LONG, -1 = SHORT.
 * Returns null if the stop is not on the loss side of the entry price.
 */
export function simulateTrade(
  side: 1 | -1, fill: number, stop: number,
  targets: readonly [number, number, number], weights: readonly [number, number, number],
  candles: Candle[], from: number, maxHold: number, costPct: number,
): TradeSim | null {
  const risk = (fill - stop) * side;
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const rOf = (p: number): number => ((p - fill) * side) / risk;
  const lastIdx = Math.min(candles.length - 1, from + Math.max(1, maxHold) - 1);

  let hits = 0;
  let exitIdx = -1;
  let exitPrice = Number.NaN;
  let reason: ExitReason | null = null;

  for (let j = from; j <= lastIdx; j++) {
    const c = candles[j];
    if (!c) break;
    if (side > 0 ? c.low <= stop : c.high >= stop) { exitIdx = j; exitPrice = stop; reason = "SL"; break; }
    while (hits < 3) {
      const tp = targets[hits];
      if (tp === undefined || !(side > 0 ? c.high >= tp : c.low <= tp)) break;
      hits++;
    }
    if (hits === 3) { exitIdx = j; exitPrice = targets[2]; reason = "TP3"; break; }
  }
  if (reason === null) {
    const c = candles[lastIdx];
    if (!c || lastIdx < from) return null;
    exitIdx = lastIdx;
    exitPrice = c.close;
    reason = lastIdx - from + 1 >= maxHold ? "TIMEOUT" : "END";
  }

  let grossR = 0;
  for (let k = 0; k < 3; k++) grossR += (weights[k] ?? 0) * rOf(k < hits ? (targets[k] ?? exitPrice) : exitPrice);
  const netR = grossR - ((costPct / 100) * fill) / risk;
  return { exitIdx, exitPrice, hits: hits as 0 | 1 | 2 | 3, reason, grossR, netR, bars: exitIdx - from + 1 };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

const emptySkips = (): BacktestSkips => ({ signals: 0, btcFilter: 0, noEntry: 0, badStop: 0, cluster: 0, openAtEnd: 0 });

async function runSymbol(
  h: SymbolHistory, btc: Candle[] | null, btcBiases: Bias[], opts: BacktestOptions,
): Promise<{ trades: BacktestTrade[]; skips: BacktestSkips; decisions: number }> {
  const tf = opts.timeframe;
  const tfMs = TF_MS[tf];
  const confMs = h.confTimeframe ? TF_MS[h.confTimeframe] : 0;
  const P = h.primary;
  const cfg: BuilderConfig = { ...DEFAULT_CONFIG, ...opts.config, minScore: opts.minScore };
  const trades: BacktestTrade[] = [];
  const skips = emptySkips();
  let decisions = 0;

  const first = Math.max(WINDOW - 1, P.length - 1 - opts.testBars);
  for (let i = first; i < P.length - 1; i++) {
    const cur = P[i], next = P[i + 1];
    if (!cur || !next) break;
    if (decisions % 20 === 19) await tick(); // keep the live scanner and API responsive
    decisions++;

    const decisionTime = cur.timestamp + tfMs;
    const sig = buildSignal({
      symbol: h.symbol, exchange: "okx", marketType: "swap",
      timeframe: { primary: tf, confirmation: h.confTimeframe ?? "none", execution: EXECUTION_TF[tf] },
      candles: windowAt(P, i),
      confirmation: h.confTimeframe ? confirmationWindow(h.confirmation, confMs, decisionTime) : null,
      change24hPct: change24hPct(P, i, tf),
      derivatives: null,
      news: null,
    }, { now: decisionTime, config: { ...opts.config, minScore: opts.minScore } });

    if (sig.direction !== "LONG" && sig.direction !== "SHORT") continue;
    const stop = sig.stopLoss.price, tp1 = sig.takeProfit.tp1, tp2 = sig.takeProfit.tp2, tp3 = sig.takeProfit.tp3;
    if (stop === null || tp1 === null || tp2 === null || tp3 === null) continue;
    skips.signals++;

    const side: 1 | -1 = sig.direction === "LONG" ? 1 : -1;
    if (opts.btcFilter && h.symbol !== "BTCUSDT" && btc) {
      const bias = biasAt(btcBiases, btc, tfMs, decisionTime);
            const strictBtc = (process.env.BTC_FILTER ?? "strict").toLowerCase() === "strict";
      if (strictBtc ? bias !== side : bias !== 0 && bias !== side) { skips.btcFilter++; continue; }
    }
    if (next.open < sig.entry.min || next.open > sig.entry.max) { skips.noEntry++; continue; }

    const sim = simulateTrade(side, next.open, stop, [tp1, tp2, tp3], cfg.exitWeights, P, i + 1, opts.maxHoldBars, opts.costPct);
    if (!sim) { skips.badStop++; continue; }
    if (sim.reason === "END") { skips.openAtEnd++; break; }

    const exitCandle = P[sim.exitIdx];
    trades.push({
      symbol: h.symbol, direction: sig.direction, score: sig.score.total,
      decisionTime, entryTime: next.timestamp, exitTime: (exitCandle?.timestamp ?? next.timestamp) + tfMs,
      entry: next.open, stop, tp1, tp2, tp3, plannedRR: sig.riskReward.weighted,
      hits: sim.hits, reason: sim.reason, bars: sim.bars, grossR: sim.grossR, r: sim.netR,
    });
    i = sim.exitIdx; // one trade per symbol at a time: next decision is after the exit candle
  }
  return { trades, skips, decisions };
}

/**
 * Cluster limit: correlated coins hit their stops together, so at most `max` trades may be open in
 * one direction at once. Trades are considered in the order they would have been opened.
 */
export function applyClusterLimit(trades: BacktestTrade[], max: number): { kept: BacktestTrade[]; dropped: number } {
  if (max <= 0) return { kept: trades, dropped: 0 };
  const sorted = [...trades].sort((a, b) => a.entryTime - b.entryTime || a.symbol.localeCompare(b.symbol));
  const kept: BacktestTrade[] = [];
  for (const t of sorted) {
    const open = kept.filter((k) => k.direction === t.direction && k.entryTime <= t.entryTime && k.exitTime > t.entryTime).length;
    if (open < max) kept.push(t);
  }
  return { kept, dropped: sorted.length - kept.length };
}

/**
 * Runs the backtest on already-loaded histories (see backtestData.ts). `btc` is the BTCUSDT primary
 * series on the same timeframe, used by the BTC filter; pass null to disable that filter.
 */
export async function runBacktest(
  histories: SymbolHistory[], btc: Candle[] | null, opts: BacktestOptions, hooks: BacktestHooks = {},
): Promise<BacktestResult> {
  const btcBiases = btc && opts.btcFilter ? biasSeries(btc) : [];
  const skips = emptySkips();
  const all: BacktestTrade[] = [];
  let decisions = 0;
  let from = Number.POSITIVE_INFINITY, to = 0;

  let done = 0;
  for (const h of histories) {
    const r = await runSymbol(h, btc, btcBiases, opts);
    all.push(...r.trades);
    decisions += r.decisions;
    for (const k of Object.keys(skips) as (keyof BacktestSkips)[]) skips[k] += r.skips[k];
    const firstBar = h.primary[Math.max(WINDOW - 1, h.primary.length - 1 - opts.testBars)];
    const lastBar = h.primary[h.primary.length - 1];
    if (firstBar) from = Math.min(from, firstBar.timestamp);
    if (lastBar) to = Math.max(to, lastBar.timestamp + TF_MS[opts.timeframe]);
    hooks.onProgress?.(++done, histories.length);
    await tick();
  }

  const { kept, dropped } = applyClusterLimit(all, opts.maxOpenPerDirection);
  skips.cluster = dropped;
  return {
    options: opts, symbols: histories.map((h) => h.symbol), trades: kept.sort((a, b) => a.exitTime - b.exitTime),
    skips, decisions, fromTime: Number.isFinite(from) ? from : 0, toTime: to,
  };
}
