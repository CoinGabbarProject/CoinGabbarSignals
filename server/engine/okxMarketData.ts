import type { Candle, Liquidation, Timeframe } from "../../shared/market.js";
import type { DerivativesInput } from "../../shared/scoring.js";

import type { MarketData, MarketDataConfig, MarketSnapshot, OrderBookSnapshot, Ticker24h } from "./marketData.js";

const BAR: Record<Timeframe, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1H": "1H", "4H": "4H", "1D": "1Dutc" };
const BAR_MS: Record<Timeframe, number> = { "1m": 6e4, "5m": 3e5, "15m": 9e5, "30m": 18e5, "1H": 36e5, "4H": 144e5, "1D": 864e5 };
const STAT: Record<Timeframe, string> = { "1m": "5m", "5m": "5m", "15m": "15m", "30m": "30m", "1H": "1H", "4H": "4H", "1D": "1D" };
const TAKER: Record<Timeframe, string> = { "1m": "5m", "5m": "5m", "15m": "5m", "30m": "5m", "1H": "1H", "4H": "1H", "1D": "1D" };

const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new Error("Non-numeric value in exchange response");
  return n;
};
const arr = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new Error("Unexpected exchange response shape");
  return v;
};
const obj = (v: unknown): Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("Unexpected exchange response shape");
  return v as Record<string, unknown>;
};
const settled = <T>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);
const base = (symbol: string): string => symbol.replace(/USDT$/, "");

export class OkxMarketData implements MarketData {
  private blockedUntil = 0;
  constructor(
    private readonly host = "https://www.okx.com",
    private readonly timeoutMs = 8000,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async get(path: string, params: Record<string, string | number>): Promise<unknown[]> {
    if (Date.now() < this.blockedUntil) {
      throw new Error(`OKX cooldown active (${Math.ceil((this.blockedUntil - Date.now()) / 60000)} min left)`);
    }
    const url = new URL(path, this.host);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(url.toString(), { signal: ctrl.signal, headers: { Accept: "application/json" } });
      let body: Record<string, unknown> | null = null;
      try { body = (await res.json()) as Record<string, unknown>; } catch { body = null; }
      if (res.status === 429 || body?.code === "50011") {
        this.blockedUntil = Date.now() + 2 * 60_000;
        throw new Error(`HTTP 429 from ${url.host}${url.pathname} (rate limit, pausing 2 min)`);
      }
      if (res.status === 403 || res.status === 418) {
        this.blockedUntil = Date.now() + 10 * 60_000;
        throw new Error(`HTTP ${res.status} from ${url.host}${url.pathname} (blocked, pausing 10 min)`);
      }
      if (!body) throw new Error(`HTTP ${res.status} from ${url.host}${url.pathname}`);
      if (body.code !== "0") {
        throw Object.assign(new Error(`OKX ${String(body.code)}: ${String(body.msg)} (${url.pathname})`), { okxCode: String(body.code) });
      }
      return Array.isArray(body.data) ? body.data : [];
    } finally {
      clearTimeout(timer);
    }
  }

  private readonly kind = new Map<string, "swap" | "spot">();
  marketTypeOf(symbol: string): "swap" | "spot" { return this.kind.get(symbol) ?? "swap"; }

  /** Try the perpetual swap first; fall back to the spot pair only if the swap does not exist. */
  private async withInst<T>(symbol: string, fn: (instId: string) => Promise<T>): Promise<T> {
    try {
      const v = await fn(`${base(symbol)}-USDT-SWAP`);
      this.kind.set(symbol, "swap");
      return v;
    } catch (e) {
      if ((e as { okxCode?: string }).okxCode === "51001") {
        const v = await fn(`${base(symbol)}-USDT`);
        this.kind.set(symbol, "spot");
        return v;
      }
      throw e;
    }
  }

  async getCandles(symbol: string, tf: Timeframe, limit: number, now: number, includeForming = false): Promise<Candle[]> {
    const rows = await this.withInst(symbol, (instId) =>
      this.get("/api/v5/market/candles", { instId, bar: BAR[tf], limit: Math.min(limit + 1, 300) }));
    const out: Candle[] = [];
    for (const row of rows) {
      const r = arr(row);
      const ts = toNum(r[0]);
      if (!includeForming && ts + BAR_MS[tf] > now) continue; // still forming
      out.push({ timestamp: ts, open: toNum(r[1]), high: toNum(r[2]), low: toNum(r[3]), close: toNum(r[4]), volume: toNum(r[6] ?? r[5]) });
    }
    out.sort((a, b) => a.timestamp - b.timestamp);
    return out.slice(-limit);
  }

  async getTicker24h(symbol: string): Promise<Ticker24h> {
    return this.withInst(symbol, async (instId) => {
      const o = obj((await this.get("/api/v5/market/ticker", { instId }))[0]);
      const last = toNum(o.last), open = toNum(o.open24h);
      const vol = toNum(o.volCcy24h);
      return { change24hPct: open > 0 ? ((last - open) / open) * 100 : 0, volume24h: instId.endsWith("-SWAP") ? vol * last : vol };
    });
  }

  private async getOrderBook(symbol: string): Promise<OrderBookSnapshot> {
    const o = await this.withInst(symbol, async (instId) => obj((await this.get("/api/v5/market/books", { instId, sz: 20 }))[0]));
    const bids = arr(o.bids), asks = arr(o.asks);
    const sum = (side: unknown[]): number => side.reduce<number>((a, l) => a + toNum(arr(l)[1]), 0);
    const bidVolume = sum(bids), askVolume = sum(asks);
    const bestBid = bids.length ? toNum(arr(bids[0])[0]) : null;
    const bestAsk = asks.length ? toNum(arr(asks[0])[0]) : null;
    const total = bidVolume + askVolume;
    return {
      bidVolume, askVolume,
      imbalance: total > 0 ? (bidVolume - askVolume) / total : null,
      spread: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null,
      midpoint: bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null,
    };
  }

  /** Recent filled liquidation orders (public endpoint, no API key). Quantity is in contracts: use ratios only. */
  async getLiquidations(symbol: string): Promise<Liquidation[]> {
    const rows = await this.get("/api/v5/public/liquidation-orders", {
      instType: "SWAP", uly: `${base(symbol)}-USDT`, state: "filled", limit: 100,
    });
    const out: Liquidation[] = [];
    for (const row of rows) {
      const details = obj(row).details;
      if (!Array.isArray(details)) continue;
      for (const d of details) {
        const o = obj(d);
        // A liquidated LONG is closed by a forced SELL; a liquidated SHORT by a forced BUY.
        const side: "long" | "short" = o.posSide === "long" || o.posSide === "short" ? o.posSide : o.side === "sell" ? "long" : "short";
        const price = Number(o.bkPx), quantity = Number(o.sz), timestamp = Number(o.ts);
        if (Number.isFinite(price) && Number.isFinite(quantity) && Number.isFinite(timestamp) && price > 0 && quantity > 0) {
          out.push({ timestamp, side, price, quantity });
        }
      }
    }
    return out;
  }

  async getDerivatives(symbol: string, tf: Timeframe): Promise<DerivativesInput> {
    const instId = `${base(symbol)}-USDT-SWAP`;
    const period = STAT[tf];
    const [funding, oi, ls, top, taker, book] = await Promise.allSettled([
      this.get("/api/v5/public/funding-rate", { instId }).then((r) => toNum(obj(r[0]).fundingRate)),
      this.get("/api/v5/rubik/stat/contracts/open-interest-history", { instId, period, limit: 15 }).then((r) => {
        // newest first: [ts, oi, oiCcy, oiUsd]
        const last = toNum(arr(r[0])[1]), first = toNum(arr(r[r.length - 1])[1]);
        if (r.length < 2 || first <= 0) throw new Error("Not enough open-interest history");
        return ((last - first) / first) * 100;
      }),
      this.get("/api/v5/rubik/stat/contracts/long-short-account-ratio-contract", { instId, period, limit: 1 }).then((r) => toNum(arr(r[0])[1])),
      this.get("/api/v5/rubik/stat/contracts/long-short-position-ratio-contract-top-trader", { instId, period, limit: 1 }).then((r) => toNum(arr(r[0])[1])),
      this.get("/api/v5/rubik/stat/taker-volume-contract", { instId, period: TAKER[tf], unit: 2, limit: 12 }).then((r) => {
        // [ts, sellVol, buyVol]
        let sell = 0, buy = 0;
        for (const row of r) { sell += toNum(arr(row)[1]); buy += toNum(arr(row)[2]); }
        if (sell <= 0) throw new Error("No taker volume");
        return buy / sell;
      }),
      this.getOrderBook(symbol).then((b) => b.imbalance),
    ]);
    return {
      fundingRate: settled(funding), oiChangePct: settled(oi), longShortRatio: settled(ls), bookImbalance: settled(book),
      topTraderRatio: settled(top), takerBuySellRatio: settled(taker),
    };
  }

  async getMarketSnapshot(symbol: string, tf: Timeframe): Promise<MarketSnapshot> {
    const [ticker, derivatives, orderBook] = await Promise.allSettled([
      this.getTicker24h(symbol), this.getDerivatives(symbol, tf), this.getOrderBook(symbol),
    ]);
    return {
      ticker: ticker.status === "fulfilled" ? ticker.value : { change24hPct: 0, volume24h: 0 },
      derivatives: derivatives.status === "fulfilled" ? derivatives.value
        : { fundingRate: null, oiChangePct: null, longShortRatio: null, bookImbalance: null },
      orderBook: orderBook.status === "fulfilled" ? orderBook.value
        : { bidVolume: null, askVolume: null, imbalance: null, spread: null, midpoint: null },
      timestamp: Date.now(),
    };
  }
}

export function createMarketData(_cfg?: MarketDataConfig): MarketData {
  return new OkxMarketData();
}
