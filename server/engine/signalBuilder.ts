import { randomUUID } from "node:crypto";
import type { Timeframe } from "../../shared/market.js";
import { calcAdvanced, calcIndicators } from "../../shared/indicators.js";
import type { SRLevel } from "../../shared/indicators.js";
import { scoreSetup } from "../../shared/scoring.js";
import type { ScoreInput, ScoreResult } from "../../shared/scoring.js";
import type { FinalSignal } from "../models/signal.js";

/**
 * Step 4 - Signal builder.
 *
 * Decision order (first match wins):
 *   1. criticalFailure            -> NO_TRADE  (always overrides the score)
 *   2. side NEUTRAL               -> WAIT
 *   3. score < minScore           -> WAIT
 *   4. invalid / too-close levels -> NO_TRADE
 *   5. R:R below minimum          -> NO_TRADE
 *   (a tradeable result on stale data -> NO_TRADE)
 *   6. otherwise                  -> LONG / SHORT with entry, stop, TP1-3 and R:R
 *
 * R:R here is THEORETICAL (planned reward / planned risk). Realized R:R after
 * fees and slippage belongs to the backtester, not to this file.
 */

export interface BuilderConfig {
  minScore: number;          // below this a valid side becomes WAIT
  minTp1R: number;           // TP1 must be at least this many R away
  minWeightedR: number;      // weighted R:R across TP1-3 must reach this
  atrStopMult: number;       // fallback stop distance in ATR
  stopBufferAtr: number;     // buffer placed beyond a structural level
  minStopAtr: number;        // structural stop closer than this is too tight -> ATR stop
  maxStopAtr: number;        // structural stop farther than this is too wide -> ATR stop
  targetsR: [number, number, number];
  exitWeights: [number, number, number]; // share of the position closed at TP1/TP2/TP3
  levelBufferAtr: number;    // TP1 is placed this far before an opposing level
  entryBehindAtr: number;    // entry zone depth on the pullback side
  entryAheadAtr: number;     // entry zone depth on the chase side
  expiryCandles: number;     // entry idea expires after this many primary candles
  staleAfterCandles: number; // last candle older than this many candles -> DELAYED
}

export const DEFAULT_MIN_SCORE = 75;

export const DEFAULT_CONFIG: BuilderConfig = {
  minScore: DEFAULT_MIN_SCORE,
  minTp1R: 1,
    minWeightedR: Number(process.env.MIN_WEIGHTED_R ?? "1.5"),
  atrStopMult: 2,
  stopBufferAtr: 0.25,
  minStopAtr: 1.5,
  maxStopAtr: 3,
  targetsR: [1.5, 2.5, 4],
  exitWeights: [0.5, 0.3, 0.2],
  levelBufferAtr: 0.1,
  entryBehindAtr: 0.3,
  entryAheadAtr: 0.1,
  expiryCandles: 3,
  staleAfterCandles: 2,
};

export interface BuildSignalInput extends ScoreInput {
  symbol: string;
  exchange: string;
  marketType: string;
  timeframe: { primary: Timeframe; confirmation: string; execution: string };
  volume24h?: number | null;
}

export interface BuildOptions {
  config?: Partial<BuilderConfig>;
  now?: number;
  id?: string;
}

export interface TradePlan {
  entry: { min: number; max: number; ideal: number };
  stop: { price: number; method: "STRUCTURE_ATR" | "ATR"; reason: string };
  targets: [number, number, number];
  rr: { tp1: number; tp2: number; tp3: number; weighted: number };
  notes: string[];
}
export type PlanResult = { ok: true; plan: TradePlan } | { ok: false; reason: string };

const TF_MS: Record<Timeframe, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1H": 3_600_000, "4H": 14_400_000, "1D": 86_400_000,
};

const roundPrice = (p: number): number => Number(p.toPrecision(8));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const fin = (n: number): boolean => Number.isFinite(n);

/**
 * Pure level planner. `side` 1 = LONG, -1 = SHORT.
 * `behind` = nearest level on the stop side, `ahead` = nearest opposing level.
 */
export function planTrade(
  side: 1 | -1, close: number, atr: number,
  behind: SRLevel | null, ahead: SRLevel | null,
  cfg: BuilderConfig = DEFAULT_CONFIG,
): PlanResult {
  if (!fin(close) || close <= 0 || !fin(atr) || atr <= 0) return { ok: false, reason: "Price or ATR invalid for level planning" };
  const notes: string[] = [];

  // ---- entry: market price is the ideal, zone allows a small pullback ----
  const ideal = roundPrice(close);
  const behindDepth = cfg.entryBehindAtr * atr, aheadDepth = cfg.entryAheadAtr * atr;
  const a = roundPrice(ideal - side * behindDepth), b = roundPrice(ideal + side * aheadDepth);
  const entry = { min: Math.min(a, b), max: Math.max(a, b), ideal };

  // ---- stop: structural level + ATR buffer if sane, otherwise pure ATR ----
  let dist = cfg.atrStopMult * atr;
  let method: TradePlan["stop"]["method"] = "ATR";
  let reason = `${cfg.atrStopMult} x ATR from entry`;
  if (behind) {
    const d = Math.abs(ideal - behind.price) + cfg.stopBufferAtr * atr;
    const inAtr = d / atr;
    if (inAtr >= cfg.minStopAtr && inAtr <= cfg.maxStopAtr) {
      dist = d; method = "STRUCTURE_ATR";
      reason = `Beyond ${side > 0 ? "support" : "resistance"} ${roundPrice(behind.price)} plus ${cfg.stopBufferAtr} ATR buffer`;
    } else notes.push(`Structural stop skipped (${inAtr.toFixed(1)} ATR away), ATR stop used`);
  }
  const stop = roundPrice(ideal - side * dist);
  const risk = Math.abs(ideal - stop);
  if (!fin(stop) || stop <= 0 || risk <= 0) return { ok: false, reason: "Stop loss could not be placed on a valid price" };

  // ---- targets: R multiples, TP1 capped just before the opposing level ----
  let tp1R: number = cfg.targetsR[0];
  if (ahead) {
    const roomR = (Math.abs(ahead.price - ideal) - cfg.levelBufferAtr * atr) / risk;
    if (roomR < cfg.minTp1R) return { ok: false, reason: `Next opposing level leaves only ${Math.max(roomR, 0).toFixed(1)}R of room (minimum ${cfg.minTp1R}R)` };
    if (roomR < tp1R) { tp1R = roomR; notes.push("TP1 placed just before the next opposing level"); }
  }
  const tp2R = Math.max(cfg.targetsR[1], tp1R + 0.5);
  const tp3R = Math.max(cfg.targetsR[2], tp2R + 0.5);
  const tp = (r: number): number => roundPrice(ideal + side * risk * r);
  const targets: [number, number, number] = [tp(tp1R), tp(tp2R), tp(tp3R)];
  if (targets.some((t) => !fin(t) || t <= 0)) return { ok: false, reason: "Take-profit could not be placed on a valid price" };

  // ---- R:R from the ROUNDED prices so stored numbers are self-consistent ----
  const r = targets.map((t) => Math.abs(t - ideal) / risk);
  const [w1, w2, w3] = cfg.exitWeights;
  const weighted = (r[0] ?? 0) * w1 + (r[1] ?? 0) * w2 + (r[2] ?? 0) * w3;
  const rr = { tp1: round2(r[0] ?? 0), tp2: round2(r[1] ?? 0), tp3: round2(r[2] ?? 0), weighted: round2(weighted) };
  if (rr.weighted < cfg.minWeightedR) return { ok: false, reason: `Weighted R:R ${rr.weighted} is below the ${cfg.minWeightedR} minimum` };

  return { ok: true, plan: { entry, stop: { price: stop, method, reason }, targets, rr, notes } };
}

type Decision =
  | { kind: "TRADE"; plan: TradePlan }
  | { kind: "WAIT" | "NO_TRADE"; reason: string };

function decide(scored: ScoreResult, close: number, atr: number, ind: { ns: SRLevel | null; nr: SRLevel | null } | null, cfg: BuilderConfig): Decision {
  if (scored.criticalFailure) return { kind: "NO_TRADE", reason: scored.criticalFailure };
  if (scored.side === "NEUTRAL") return { kind: "WAIT", reason: "No clear directional bias" };
  if (scored.score.total < cfg.minScore) return { kind: "WAIT", reason: `Setup score ${scored.score.total} is below the ${cfg.minScore} minimum` };
  if (!ind) return { kind: "NO_TRADE", reason: "Support/resistance levels unavailable" };
  const s = scored.side === "LONG" ? 1 : -1;
  const planned = planTrade(s, close, atr, s > 0 ? ind.ns : ind.nr, s > 0 ? ind.nr : ind.ns, cfg);
  return planned.ok ? { kind: "TRADE", plan: planned.plan } : { kind: "NO_TRADE", reason: planned.reason };
}

export function buildSignal(input: BuildSignalInput, opts: BuildOptions = {}): FinalSignal {
  const cfg: BuilderConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const now = opts.now ?? Date.now();
  const iso = new Date(now).toISOString();
  const { candles } = input;

  const scored = scoreSetup(input);
  const ind = calcIndicators(candles);
  const adv = calcAdvanced(candles);
  const last = candles[candles.length - 1];
  const close = last?.close ?? 0;
  const atr = ind?.atr.value ?? NaN;

  const tfMs = TF_MS[input.timeframe.primary];
  const age = last ? now - last.timestamp : Infinity;
  const stale = last !== undefined && age > cfg.staleAfterCandles * tfMs;

  let decision = decide(scored, close, atr, adv ? { ns: adv.levels.nearestSupport, nr: adv.levels.nearestResistance } : null, cfg);
  // Never emit a tradeable signal on a stalled feed.
  if (decision.kind === "TRADE" && stale) decision = { kind: "NO_TRADE", reason: "Market data is stale (last candle too old)" };
  const isTrade = decision.kind === "TRADE";
  const plan = decision.kind === "TRADE" ? decision.plan : null;
  const side = scored.side === "SHORT" ? -1 : 1;

  // ---- reasoning ----
  const { total } = scored.score;
  const primaryReason = decision.kind === "TRADE"
    ? `${scored.side} setup, score ${total}/100${scored.confirmations[0] ? `: ${scored.confirmations.slice(0, 2).join("; ")}` : ""}`
    : decision.reason;
  const warnings = [...scored.warnings, ...(plan?.notes ?? [])];
  const invalidation = plan
    ? `${side > 0 ? "Close below" : "Close above"} ${plan.stop.price} invalidates the setup`
    : "No active setup";

  // ---- data quality ----
  const dqStatus: FinalSignal["dataQuality"]["status"] =
    !ind || !last ? "UNAVAILABLE"
    : stale ? "DELAYED"
    : scored.unavailable.length > 0 ? "PARTIAL"
    : "FRESH";
  const sources = [input.exchange, ...(scored.unavailable.length ? [`missing:${scored.unavailable.join(",")}`] : [])];

  const entry = plan
    ? { ...plan.entry, trigger: `Price inside ${plan.entry.min}-${plan.entry.max}, ideal ${plan.entry.ideal}`, expiry: new Date(now + cfg.expiryCandles * tfMs).toISOString() }
    : { min: close, max: close, ideal: close, trigger: `No entry: ${primaryReason}`, expiry: iso };

  return {
    id: opts.id ?? randomUUID(),
    symbol: input.symbol.toUpperCase(),
    exchange: input.exchange,
    marketType: input.marketType,
    direction: isTrade ? scored.side as "LONG" | "SHORT" : decision.kind as "WAIT" | "NO_TRADE",
    status: isTrade ? "ACTIVE" : "INACTIVE",
    timeframe: input.timeframe,
    market: {
      currentPrice: close,
      "24hChange": input.change24hPct ?? 0,
      volume: input.volume24h ?? 0,
      volatility: fin(atr) && close > 0 ? round2((atr / close) * 100) : 0,
    },
    entry,
    stopLoss: plan
      ? { price: plan.stop.price, method: plan.stop.method, reason: plan.stop.reason }
      : { price: null, method: "NONE", reason: primaryReason },
    takeProfit: plan
      ? { tp1: plan.targets[0], tp2: plan.targets[1], tp3: plan.targets[2] }
      : { tp1: null, tp2: null, tp3: null },
    riskReward: plan ? plan.rr : { tp1: 0, tp2: 0, tp3: 0, weighted: 0 },
    score: scored.score,
    technical: ind && adv ? { rsi: ind.rsi, macd: ind.macd, bollinger: ind.bollinger, atr: ind.atr, vwap: ind.vwap, ema20: ind.ema20, ema50: ind.ema50, sma200: ind.sma200, adx: adv.adx, stochRsi: adv.stochRsi, obv: adv.obv } : {},
    structure: { bias: scored.side },
    liquidity: adv ? { supports: adv.levels.supports, resistances: adv.levels.resistances } : {},
    derivatives: { ...(input.derivatives ?? {}) },
    marketContext: { change24hPct: input.change24hPct ?? null, unavailable: scored.unavailable },
    reasoning: { primaryReason, confirmations: scored.confirmations, conflicts: scored.conflicts, warnings, invalidation },
    dataQuality: { status: dqStatus, timestamp: last ? new Date(last.timestamp).toISOString() : iso, sources },
    events: [],
    timestamps: { createdAt: iso, updatedAt: iso, closedAt: null },
  };
}
