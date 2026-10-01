import type { Timeframe } from "../../shared/market.js";

/** Same set as shared/market.ts `Timeframe` and the server's TIMEFRAMES (server/config/env.ts). */
export const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "30m", "1H", "4H", "1D"];
export const DEFAULT_TIMEFRAME: Timeframe = "1H";

export const isTimeframe = (v: string | null | undefined): v is Timeframe =>
  v !== null && v !== undefined && (TIMEFRAMES as readonly string[]).includes(v);
