import type { Candle, Timeframe } from "../../shared/market.js";
import type { FinalSignal } from "../models/signal.js";
import { EXECUTION_TF } from "./marketData.js";
import type { MarketData } from "./marketData.js";
import type { SignalHits, SignalOutcome, SignalStore } from "./store.js";

const TF_MS: Record<string, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1H": 3_600_000, "4H": 14_400_000, "1D": 86_400_000,
};
const CANDLE_LIMIT = 1000;
// Staged trailing stop: after TP1 the stop moves to entry (breakeven), after TP2 it moves to TP1. Set TRAILING_STOP=false to turn off.
const TRAILING_ON = (process.env.TRAILING_STOP ?? "true").toLowerCase() !== "false";
// Pre-TP1 protection: once price covers this fraction of the entry→TP1 distance, SL moves to entry.
const PRE_TP1_BE = Number(process.env.PRE_TP1_BE ?? "0");
// Percentage trailing: after armed / TP1, SL follows the best price by this % (0 = off).
const TRAIL_PCT = Number(process.env.TRAIL_PCT ?? "1.5");

export const trackHorizonMs = (execTf: string): number => (TF_MS[execTf] ?? 300_000) * CANDLE_LIMIT * 0.9;

export type Evaluation =
  | { kind: "outcome"; outcome: SignalOutcome }
  | { kind: "entered" }
  | { kind: "expired" }
  | null;

export function evaluateOutcome(s: FinalSignal, candles: Candle[], now: number, execMs = 0): Evaluation {
  if (s.direction !== "LONG" && s.direction !== "SHORT") return null;
  const long = s.direction === "LONG";
  const sl = s.stopLoss.price;
  const tps = [s.takeProfit.tp1, s.takeProfit.tp2, s.takeProfit.tp3];
  if (sl === null || tps[0] === null) return null;

  const createdMs = Date.parse(s.timestamps.createdAt);
  const expiryMs = Date.parse(s.entry.expiry);
  let entered = false;
let best = 0;
let armed = false;
  let ext = 0;
  const hits: SignalHits = {};

  const label = (n: number): SignalOutcome["status"] => (n === 1 ? "TP1_HIT" : n === 2 ? "TP2_HIT" : "TP3_HIT");
  const stopNow = (): number => {
    if (!TRAILING_ON) return sl;
    if (best === 0 && !armed) return sl;
    const base = best <= 1 ? s.entry.ideal : (tps[0] as number);
    if (!(TRAIL_PCT > 0) || ext === 0) return base;
    const t = long ? ext * (1 - TRAIL_PCT / 100) : ext * (1 + TRAIL_PCT / 100);
    return long ? Math.max(base, t) : Math.min(base, t);
  };
  const trailing = (): number | undefined => {
    if (!TRAILING_ON || !(best > 0 || armed)) return undefined;
    const st = stopNow();
    return st === sl ? undefined : st; // sirf tab jab SL asli SL se hila ho
  };
  const done = (closed: boolean, exit?: number): Evaluation => {
    const trailStop = trailing();
    const withTrail = <T extends SignalOutcome>(o: T): T => (trailStop === undefined ? o : { ...o, trailStop });
 if (best === 0) return closed ? { kind: "outcome", outcome: withTrail({ status: armed ? "BE_HIT" : "SL_HIT", exit: exit ?? sl, closed: true, hits }) } : { kind: "entered" };
    return { kind: "outcome", outcome: withTrail({ status: label(best), exit: exit ?? (tps[best - 1] as number), closed, hits }) };
  };

  for (const c of candles) {
   if (c.timestamp + execMs <= createdMs) continue; // fully before the signal
    // The candle already running when the signal was created can only fill the entry.
    // Its wicks may be from before the signal existed, so it never counts for SL / TP.
    const beforeSignal = c.timestamp < createdMs;
    if (!entered) {
      if (Number.isFinite(expiryMs) && c.timestamp >= expiryMs) break;
      if (c.low <= s.entry.max && c.high >= s.entry.min) entered = true;
      else continue;
    }
    if (beforeSignal) continue;
    const stop = stopNow(); // uses the TP progress up to the previous candle (conservative)
    const slHit = long ? c.low <= stop : c.high >= stop;
 if (slHit) { hits.sl = c.timestamp; return done(true, best === 0 && !armed ? undefined : stop); }
    while (best < 3) {
      const tp = tps[best];
      if (tp === null || tp === undefined) break;
      if (!(long ? c.high >= tp : c.low <= tp)) break;
      best++;
      hits[`tp${best}` as "tp1" | "tp2" | "tp3"] = c.timestamp;
    }
if (TRAILING_ON && PRE_TP1_BE > 0 && !armed && best === 0) {
      const trig = s.entry.ideal + ((tps[0] as number) - s.entry.ideal) * PRE_TP1_BE;
      if (long ? c.high >= trig : c.low <= trig) armed = true;
    }
    if (armed || best > 0) ext = long ? Math.max(ext || c.high, c.high) : Math.min(ext || c.low, c.low);
    if (best === 3) return done(true);
  }
  if (entered) return done(false);
  return Number.isFinite(expiryMs) && now >= expiryMs ? { kind: "expired" } : null;
}

export interface TrackerDeps {
  market: MarketData;
  store: SignalStore;
  now?: () => number;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export async function trackOutcomes(deps: TrackerDeps): Promise<number> {
  const now = deps.now ? deps.now() : Date.now();
  const atIso = new Date(now).toISOString();
  const log = deps.log ?? console;
  const open = await deps.store.listTrackable();
  const cache = new Map<string, Candle[]>();
  let changed = 0;

  for (const s of open) {
    try {
      const exec = EXECUTION_TF[s.timeframe.primary as Timeframe];
      if (!exec) continue;
      const key = `${s.symbol}:${exec}`;
      let candles = cache.get(key);
      if (!candles) {
        candles = await deps.market.getCandles(s.symbol, exec, CANDLE_LIMIT, now, true);
        cache.set(key, candles);
      }
      const ev = evaluateOutcome(s, candles, now, TF_MS[exec] ?? 0);

      if (ev?.kind === "expired") {
        await deps.store.setStatus(s.id, "EXPIRED", atIso);
        changed++;
      } else if (ev?.kind === "outcome") {
        const o = ev.outcome;
        if (s.status === o.status && Boolean(s.outcome?.closed) === o.closed && s.outcome?.hits && s.outcome?.trailStop === o.trailStop) continue;
                const hitTimes = Object.values(o.hits ?? {}).filter((t): t is number => typeof t === "number");
        const outcomeIso = hitTimes.length ? new Date(Math.max(...hitTimes)).toISOString() : atIso;
        await deps.store.setOutcome(s.id, o, outcomeIso);
        changed++;
      } else if (ev?.kind === "entered") {
        if (!s.entered) { await deps.store.markEntered(s.id, atIso); changed++; }
     if (now - Date.parse(s.timestamps.createdAt) > (TF_MS[s.timeframe.primary] ?? 900_000) * 96) {
          await deps.store.setStatus(s.id, "EXPIRED", atIso);
        }
      }
    } catch (e) {
      log.error(`[tracker] ${s.symbol} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (changed > 0) log.info(`[tracker] ${changed} signal update(s)`);
  return changed;
}
