import type { Candle, Timeframe } from "../../shared/market.js";
import type { FinalSignal } from "../models/signal.js";
import { EXECUTION_TF } from "./marketData.js";
import type { MarketData } from "./marketData.js";
import type { SignalOutcome, SignalStore } from "./store.js";

export const TRACK_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

export function evaluateOutcome(s: FinalSignal, candles: Candle[]): SignalOutcome | null {
  if (s.direction !== "LONG" && s.direction !== "SHORT") return null;
  const long = s.direction === "LONG";
  const sl = s.stopLoss.price;
  const tps = [s.takeProfit.tp1, s.takeProfit.tp2, s.takeProfit.tp3];
  if (sl === null || tps[0] === null) return null;

  const createdMs = Date.parse(s.timestamps.createdAt);
  let entered = false;
  let best = 0;

  const label = (n: number): SignalOutcome["status"] => (n === 1 ? "TP1_HIT" : n === 2 ? "TP2_HIT" : "TP3_HIT");
  const result = (closed: boolean): SignalOutcome | null => {
    if (best === 0) return closed ? { status: "SL_HIT", exit: sl, closed: true } : null;
    return { status: label(best), exit: tps[best - 1] as number, closed };
  };

  for (const c of candles) {
    if (c.timestamp < createdMs) continue;
    if (!entered) {
      if (c.low <= s.entry.max && c.high >= s.entry.min) entered = true;
      else continue;
    }
    const slHit = long ? c.low <= sl : c.high >= sl;
    if (slHit) return result(true);
    while (best < 3) {
      const tp = tps[best];
      if (tp === null || tp === undefined) break;
      const hit = long ? c.high >= tp : c.low <= tp;
      if (!hit) break;
      best++;
    }
    if (best === 3) return result(true);
  }
  return best > 0 ? result(false) : null;
}

export interface TrackerDeps {
  market: MarketData;
  store: SignalStore;
  now?: () => number;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export async function trackOutcomes(deps: TrackerDeps): Promise<number> {
  const now = deps.now ? deps.now() : Date.now();
  const log = deps.log ?? console;
  const open = await deps.store.listTrackable(new Date(now - TRACK_HORIZON_MS).toISOString());
  const cache = new Map<string, Candle[]>();
  let changed = 0;

  for (const s of open) {
    try {
      const tf = s.timeframe.primary as Timeframe;
      const exec = EXECUTION_TF[tf];
      if (!exec) continue;
      const key = `${s.symbol}:${exec}`;
      let candles = cache.get(key);
      if (!candles) {
        candles = await deps.market.getCandles(s.symbol, exec, 1000, now);
        cache.set(key, candles);
      }
      const out = evaluateOutcome(s, candles);
      if (!out) continue;
      if (s.status === out.status && Boolean(s.outcome?.closed) === out.closed) continue;
      await deps.store.setOutcome(s.id, out, new Date(now).toISOString());
      changed++;
    } catch (e) {
      log.error(`[tracker] ${s.symbol} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (changed > 0) log.info(`[tracker] ${changed} signal outcome(s) updated`);
  return changed;
            }
