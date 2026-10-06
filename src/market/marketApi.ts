import type { Candle, ProviderResponse, Timeframe } from "../../shared/market.js";
import type { ApiError } from "../../shared/api.js";

export interface MarketSnapshotResponse {
  ticker: {
    change24hPct: number;
    volume24h: number;
  };
  derivatives: {
    fundingRate: number | null;
    oiChangePct: number | null;
    longShortRatio: number | null;
    bookImbalance: number | null;
    topTraderRatio?: number | null;
    takerBuySellRatio?: number | null;
  };
  orderBook: {
    bidVolume: number | null;
    askVolume: number | null;
    imbalance: number | null;
    spread: number | null;
    midpoint: number | null;
  };
  timestamp: number;
}

/** Same default the existing index.html uses; override with VITE_API_BASE. No keys or tokens live in the frontend. */
const envBase: unknown = import.meta.env["VITE_API_BASE"];
export const API_BASE: string = typeof envBase === "string" && envBase !== "" ? envBase : "https://coingabbarsignals-1.onrender.com/api/v1";

export class MarketRequestError extends Error {
  constructor(readonly userMessage: string, readonly status?: number) {
    super(userMessage);
    this.name = "MarketRequestError";
  }
}

const GENERIC = "Could not load market data. Please try again.";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * GET {API_BASE}/candles?symbol&timeframe&limit  (the "planned GET /candles" in docs/api-plan.md).
 * Expected body: ProviderResponse<Candle[]> from shared/market.ts. Raw bodies/stacks never reach the UI.
 */
export async function fetchMarketSnapshot(
  symbol: string,
  timeframe: Timeframe,
  signal: AbortSignal,
): Promise<MarketSnapshotResponse> {
  const url = new URL(`${API_BASE}/market/snapshot`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("timeframe", timeframe);

  let res: Response;

  try {
    res = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new MarketRequestError(GENERIC);
  }

  let body: unknown;

  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const err = isRecord(body)
      ? (body as Partial<ApiError>).error
      : undefined;

    const msg =
      err &&
      typeof err.message === "string" &&
      err.message.length < 200
        ? err.message
        : GENERIC;

    throw new MarketRequestError(msg, res.status);
  }

  if (!isRecord(body)) {
    throw new MarketRequestError(GENERIC, res.status);
  }

  const data = body["data"];

  if (!isRecord(data)) {
    throw new MarketRequestError(GENERIC, res.status);
  }

  return data as unknown as MarketSnapshotResponse;
}

export async function fetchCandles(symbol: string, timeframe: Timeframe, limit: number, signal: AbortSignal): Promise<Candle[]> {
  const url = new URL(`${API_BASE}/candles`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("timeframe", timeframe);
  url.searchParams.set("limit", String(limit));

  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new MarketRequestError(GENERIC);
  }

  let body: unknown;
  try { body = await res.json(); } catch { body = null; }

  if (!res.ok) {
    const err = isRecord(body) ? (body as Partial<ApiError>).error : undefined;
    const msg = err && typeof err.message === "string" && err.message.length < 200 ? err.message : GENERIC;
    throw new MarketRequestError(msg, res.status);
  }
  const data = isRecord(body) ? (body as Partial<ProviderResponse<Candle[]>>).data : undefined;
  if (!Array.isArray(data)) throw new MarketRequestError(GENERIC, res.status);
  return data as Candle[];
}
