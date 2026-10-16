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

// Telegram alerts. Render env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (missing = alerts off).
// The token is read when a message is sent, so a changed env var or a test can take effect without a restart.
export type TgResult = "sent" | "off" | "failed";
/** Delays in ms. Exposed so tests can set them to 0. */
export const tgTiming = { gapMs: 1100, retryMs: 1000 };
const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

async function tgPost(text: string): Promise<TgResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "", chat = process.env.TELEGRAM_CHAT_ID ?? "";
  if (!token || !chat) return "off";
  let plain = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: plain ? text.replace(/<[^>]+>/g, "") : text, ...(plain ? {} : { parse_mode: "HTML" }), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return "sent";
      // Telegram answers with a JSON body that says why (bad token, wrong chat id, rate limit, bad HTML ...). Never ignore it.
      const body = (await res.json().catch(() => ({}))) as { description?: string; parameters?: { retry_after?: number } };
      console.warn(`[telegram] send failed (attempt ${attempt}/3): HTTP ${res.status} ${body.description ?? ""}`.trim());
      if (res.status === 429) { await sleep(Math.min(20, body.parameters?.retry_after ?? 2) * 1000); continue; }
      if (res.status === 400 && /parse entities/i.test(body.description ?? "") && !plain) { plain = true; continue; }   // resend without formatting
      if (res.status >= 400 && res.status < 500) return "failed";                                                     // 401/403/404: retrying will not help
    } catch (e) {
      console.warn(`[telegram] send failed (attempt ${attempt}/3): ${e instanceof Error ? e.message : String(e)}`);
    }
    if (attempt < 3) await sleep(tgTiming.retryMs * attempt);
  }
  return "failed";
}

// One message at a time, with a small gap: Telegram allows about 1 message per second per chat and drops the rest (HTTP 429).
let tgQueue: Promise<unknown> = Promise.resolve();
export function tgSend(text: string): Promise<TgResult> {
  const run = tgQueue.then(() => tgPost(text), () => tgPost(text));
  tgQueue = run.then(() => sleep(tgTiming.gapMs), () => sleep(tgTiming.gapMs));
  return run;
}
export const usd = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(Number(n))) return "-";
  const v = Number(n);
  const d = v >= 1000 ? 2 : v >= 1 ? 4 : v >= 0.01 ? 5 : 8;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
};
export const tgPair = (s: FinalSignal): string =>
  `${s.direction === "LONG" ? "🟢" : "🔴"} <b>${s.symbol.replace(/USDT$/, "")}/USDT</b> · ${s.direction} · ${s.timeframe.primary}`;
// Staged trailing stop: after TP1 the stop moves to entry (breakeven), after TP2 it moves to TP1. Set TRAILING_STOP=false to turn off.
const TRAILING_ON = (process.env.TRAILING_STOP ?? "true").toLowerCase() !== "false";
// Pre-TP1 protection: once price covers this fraction of the entry→TP1 distance, SL moves to entry.
const PRE_TP1_BE = Number(process.env.PRE_TP1_BE ?? "0");
// Percentage trailing: after armed / TP1, SL follows the best price by this % (0 = off).
const TRAIL_PCT = Number(process.env.TRAIL_PCT ?? "1.5");

// Alerts that Telegram did not accept, counted per signal + status. Memory only: after a restart it simply counts again.
const tgTries = new Map<string, number>();
const TG_MAX_RUNS = 6;

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
    // OKX returns only the latest 300 candles. Once they no longer reach back to the
  // signal's creation, trust what is already stored instead of re-detecting from scratch.
  const windowShort = (candles[0]?.timestamp ?? Infinity) > createdMs;
  const prev: SignalHits = windowShort ? { ...(s.outcome?.hits ?? {}) } : {};
  let entered = windowShort && Boolean(s.entered);
  let best = prev.tp3 ? 3 : prev.tp2 ? 2 : prev.tp1 ? 1 : 0;
  let armed = false;
  let ext = 0;
  // Window short: restore trailing extreme from the stored trailStop so trailing SL does not reset to entry.
  const savedTrail = windowShort ? s.outcome?.trailStop : undefined;
  if (TRAILING_ON && TRAIL_PCT > 0 && typeof savedTrail === "number" && savedTrail > 0) {
    ext = long ? savedTrail / (1 - TRAIL_PCT / 100) : savedTrail / (1 + TRAIL_PCT / 100);
  }
  const hits: SignalHits = prev;

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

            if (ev?.kind === "expired" && !s.entered) {
        const expMs = Date.parse(s.entry.expiry);
        await deps.store.setStatus(
          s.id,
          "EXPIRED",
          Number.isFinite(expMs) && expMs <= now ? new Date(expMs).toISOString() : atIso,
        );
        changed++;
      } else if (ev?.kind === "outcome") {
        const o = ev.outcome;
        if (s.status === o.status && Boolean(s.outcome?.closed) === o.closed && s.outcome?.hits && s.outcome?.trailStop === o.trailStop) continue;
                const hitTimes = Object.values(o.hits ?? {}).filter((t): t is number => typeof t === "number");
        const outcomeIso = hitTimes.length ? new Date(Math.max(...hitTimes)).toISOString() : atIso;
        await deps.store.setOutcome(s.id, o, outcomeIso);
        const statusChanged = s.status !== o.status;
        const justClosed = o.closed && !s.outcome?.closed;
        if (statusChanged || justClosed) {
                    const head: Record<string, string> = {
            TP1_HIT: "🎯 <b>TP1 HIT</b> ✅",
            TP2_HIT: "🎯🎯 <b>TP2 HIT</b> ✅✅",
            TP3_HIT: "🏆 <b>TP3 HIT · FULL TARGET</b> 🚀",
            SL_HIT: "🛑 <b>STOP LOSS HIT</b>",
            BE_HIT: "⚖️ <b>BREAKEVEN EXIT</b>",
          };
          const trailClose = justClosed && (o.status === "TP1_HIT" || o.status === "TP2_HIT");
          const title = trailClose ? `🔒 <b>TRAILING SL HIT</b> (after ${o.status.slice(0, 3)})` : (head[o.status] ?? o.status);
          const tail = trailClose ? "🔒 Trade closed at trailing SL after TP hit."
            : o.status === "TP1_HIT" ? "🔥 Trade still running\n🛡 Trailing SL active, profit protected!"
            : o.status === "TP2_HIT" ? "🔥 Trade still running\n🛡 SL moved to TP1, profit locked!"
            : o.status === "TP3_HIT" ? "🏆 All targets done. Trade complete!"
            : o.status === "SL_HIT" ? "❌ Trade closed at loss. Risk managed, next setup loading…"
            : "⚖️ Closed at breakeven, no loss.";
          const trail = o.trailStop !== undefined && !o.closed ? `\n🛡 Trailing SL: <b>${usd(o.trailStop)}</b>` : "";
          void tgSend(`${title}\n\n${tgPair(s)}\n\n📍 Entry: ${usd(s.entry.ideal)}\n🏁 Exit: <b>${usd(o.exit)}</b>${trail}\n\n${tail}`);
        }
        changed++;
      } else if (ev?.kind === "entered") {
        if (!s.entered) {
          await deps.store.markEntered(s.id, atIso); changed++;
          void tgSend(`▶️ <b>ENTRY TRIGGERED</b>\n\n${tgPair(s)}\n\n📍 Entry: ${usd(s.entry.ideal)}\n🛑 SL: ${usd(s.stopLoss.price)}\n🎯 TP1: ${usd(s.takeProfit.tp1)}\n\n⚡ Trade is now running`);
        }
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
