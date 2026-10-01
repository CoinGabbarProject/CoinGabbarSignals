import { useCallback, useEffect, useState } from "react";
import type { Candle, Timeframe } from "../../shared/market.js";
import { fetchCandles, MarketRequestError } from "./marketApi.js";
import { validateCandles } from "./validateCandles.js";

export type CandleStatus = "loading" | "ready" | "empty" | "error";
export interface MarketCandlesState { status: CandleStatus; candles: readonly Candle[]; error: string | null; rejected: number }

const NONE: readonly Candle[] = [];
const LOADING: MarketCandlesState = { status: "loading", candles: NONE, error: null, rejected: 0 };
const EMPTY: MarketCandlesState = { status: "empty", candles: NONE, error: null, rejected: 0 };

interface Settled { key: string; value: MarketCandlesState }

/**
 * Loads + validates candles for one symbol/timeframe.
 *  - A result is only shown for the exact key it was requested for, so switching symbol/timeframe
 *    can never display the previous dataset (it reads as "loading" immediately, in the same render).
 *  - The previous request is aborted on change/unmount: no stale responses, no leaked subscriptions.
 */
export function useMarketCandles(symbol: string | null, timeframe: Timeframe, limit = 300): MarketCandlesState & { retry(): void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const key = `${symbol ?? ""}|${timeframe}|${limit}|${attempt}`;

  useEffect(() => {
    if (symbol === null) return;
    const ctrl = new AbortController();
    fetchCandles(symbol, timeframe, limit, ctrl.signal).then(
      (raw) => {
        if (ctrl.signal.aborted) return;
        const { candles, rejected } = validateCandles(raw);
        setSettled({ key, value: { status: candles.length > 0 ? "ready" : "empty", candles, error: null, rejected } });
      },
      (e: unknown) => {
        if (ctrl.signal.aborted) return;
        const error = e instanceof MarketRequestError ? e.userMessage : "Could not load market data. Please try again.";
        setSettled({ key, value: { status: "error", candles: NONE, error, rejected: 0 } });
      },
    );
    return () => ctrl.abort();
  }, [symbol, timeframe, limit, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const value = symbol === null ? EMPTY : settled !== null && settled.key === key ? settled.value : LOADING;
  return { ...value, retry };
}
