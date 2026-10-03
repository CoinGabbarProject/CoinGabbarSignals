import type { Candle, Timeframe } from "../../shared/market.js";
import type { DerivativesInput } from "../../shared/scoring.js";

/** What the scanner needs from a market-data source. Swap this for another exchange or a mock. */
export interface Ticker24h { change24hPct: number; volume24h: number }
export interface OrderBookSnapshot {
  bidVolume: number | null;
  askVolume: number | null;
  imbalance: number | null;
  spread: number | null;
  midpoint: number | null;
}

export interface MarketSnapshot {
  ticker: Ticker24h;
  derivatives: DerivativesInput;
  orderBook: OrderBookSnapshot;
  timestamp: number;
}

export interface MarketData {
  /** CLOSED candles only, oldest first. `now` decides which candle is still forming. */
  getCandles(symbol: string, tf: Timeframe, limit: number, now: number, includeForming?: boolean): Promise<Candle[]>;
  getTicker24h(symbol: string): Promise<Ticker24h>;
  /** Each field is null when its endpoint failed or is unavailable. */
  getDerivatives(symbol: string, tf: Timeframe): Promise<DerivativesInput>;
  /** Combined real-time market-analysis snapshot. */
  getMarketSnapshot(symbol: string, tf: Timeframe): Promise<MarketSnapshot>;
}

export interface MarketDataConfig { spotUrl: string; futuresUrl: string; timeoutMs: number }
export const DEFAULT_MARKET_CONFIG: MarketDataConfig = {
  spotUrl: "https://data-api.binance.vision",
  futuresUrl: "https://fapi.binance.com",
  timeoutMs: 8000,
};

export const BINANCE_INTERVAL: Record<Timeframe, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1H": "1h", "4H": "4h", "1D": "1d",
};
/** Higher timeframe used for confirmation. 1D has none, so it scores 0 and is listed as unavailable. */
export const CONFIRMATION_TF: Record<Timeframe, Timeframe | null> = {
  "1m": "5m", "5m": "15m", "15m": "1H", "30m": "4H", "1H": "4H", "4H": "1D", "1D": null,
};
export const EXECUTION_TF: Record<Timeframe, Timeframe> = {
  "1m": "1m", "5m": "1m", "15m": "5m", "30m": "5m", "1H": "15m", "4H": "1H", "1D": "4H",
};
// openInterestHist / long-short ratio only support these periods (no 1m)
const STATS_PERIOD: Record<Timeframe, string> = {
  "1m": "5m", "5m": "5m", "15m": "15m", "30m": "30m", "1H": "1h", "4H": "4h", "1D": "1d",
};

const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new Error("Non-numeric value in exchange response");
  return n;
};
const asArray = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new Error("Unexpected exchange response shape");
  return v;
};
const asObject = (v: unknown): Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("Unexpected exchange response shape");
  return v as Record<string, unknown>;
};
const settled = <T>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);

export class BinanceMarketData implements MarketData {
  constructor(
    private readonly cfg: MarketDataConfig = DEFAULT_MARKET_CONFIG,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async getJson(base: string, path: string, params: Record<string, string | number>): Promise<unknown> {
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.fetchFn(url.toString(), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url.host}${url.pathname}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async getCandles(symbol: string, tf: Timeframe, limit: number, now: number, includeForming = false): Promise<Candle[]> {
    const raw = await this.getJson(this.cfg.spotUrl, "/api/v3/klines", { symbol, interval: BINANCE_INTERVAL[tf], limit: Math.min(limit + 1, 1000) });
    const out: Candle[] = [];
    for (const row of asArray(raw)) {
      const r = asArray(row);
      if (toNum(r[6]) > now) continue; // candle still forming: never trade on it
      out.push({ timestamp: toNum(r[0]), open: toNum(r[1]), high: toNum(r[2]), low: toNum(r[3]), close: toNum(r[4]), volume: toNum(r[5]) });
    }
    return out.slice(-limit);
  }

  async getTicker24h(symbol: string): Promise<Ticker24h> {
    const o = asObject(await this.getJson(this.cfg.spotUrl, "/api/v3/ticker/24hr", { symbol }));
    return { change24hPct: toNum(o.priceChangePercent), volume24h: toNum(o.quoteVolume) };
  }

    async getMarketSnapshot(symbol: string, tf: Timeframe): Promise<MarketSnapshot> {
    const [ticker, derivatives, orderBook] = await Promise.allSettled([
      this.getTicker24h(symbol),
      this.getDerivatives(symbol, tf),
      this.getOrderBook(symbol),
    ]);

    const safeTicker: Ticker24h =
      ticker.status === "fulfilled"
        ? ticker.value
        : { change24hPct: 0, volume24h: 0 };

    const safeDerivatives: DerivativesInput =
      derivatives.status === "fulfilled"
        ? derivatives.value
        : {
            fundingRate: null,
            oiChangePct: null,
            longShortRatio: null,
            bookImbalance: null,
          };

    const safeOrderBook: OrderBookSnapshot =
      orderBook.status === "fulfilled"
        ? orderBook.value
        : {
            bidVolume: null,
            askVolume: null,
            imbalance: null,
            spread: null,
            midpoint: null,
          };

    return {
      ticker: safeTicker,
      derivatives: safeDerivatives,
      orderBook: safeOrderBook,
      timestamp: Date.now(),
    };
  }

  private async getOrderBook(symbol: string): Promise<OrderBookSnapshot> {
    const raw = await this.getJson(
      this.cfg.spotUrl,
      "/api/v3/depth",
      { symbol, limit: 20 },
    );

    const o = asObject(raw);

    const sum = (side: unknown): number =>
      asArray(side).reduce<number>(
        (total, level) => total + toNum(asArray(level)[1]),
        0,
      );

    const bids = asArray(o.bids);
    const asks = asArray(o.asks);

    const bidVolume = sum(bids);
    const askVolume = sum(asks);

    const bestBid =
      bids.length > 0 ? toNum(asArray(bids[0])[0]) : null;

    const bestAsk =
      asks.length > 0 ? toNum(asArray(asks[0])[0]) : null;

    const midpoint =
      bestBid !== null && bestAsk !== null
        ? (bestBid + bestAsk) / 2
        : null;

    const spread =
      bestBid !== null && bestAsk !== null
        ? bestAsk - bestBid
        : null;

    const total = bidVolume + askVolume;

    return {
      bidVolume,
      askVolume,
      imbalance: total > 0 ? (bidVolume - askVolume) / total : null,
      spread,
      midpoint,
    };
  }

  async getDerivatives(symbol: string, tf: Timeframe): Promise<DerivativesInput> {
    const period = STATS_PERIOD[tf];
    const [funding, oi, ls, book] = await Promise.allSettled([
      this.getJson(this.cfg.futuresUrl, "/fapi/v1/premiumIndex", { symbol }).then((r) => toNum(asObject(r).lastFundingRate)),
      this.getJson(this.cfg.futuresUrl, "/futures/data/openInterestHist", { symbol, period, limit: 15 }).then((r) => {
        const rows = asArray(r);
        const first = toNum(asObject(rows[0]).sumOpenInterest), last = toNum(asObject(rows[rows.length - 1]).sumOpenInterest);
        if (rows.length < 2 || first <= 0) throw new Error("Not enough open-interest history");
        return ((last - first) / first) * 100;
      }),
      this.getJson(this.cfg.futuresUrl, "/futures/data/globalLongShortAccountRatio", { symbol, period, limit: 1 }).then((r) => toNum(asObject(asArray(r)[0]).longShortRatio)),
      this.getJson(this.cfg.spotUrl, "/api/v3/depth", { symbol, limit: 20 }).then((r) => {
        const o = asObject(r);
        const sum = (side: unknown): number => asArray(side).reduce<number>((a, lvl) => a + toNum(asArray(lvl)[1]), 0);
        const bid = sum(o.bids), ask = sum(o.asks);
        if (bid + ask <= 0) throw new Error("Empty order book");
        return (bid - ask) / (bid + ask); // CALCULATIONS.md: (bid-ask)/(bid+ask)
      }),
    ]);
    return { fundingRate: settled(funding), oiChangePct: settled(oi), longShortRatio: settled(ls), bookImbalance: settled(book) };
  }
}
