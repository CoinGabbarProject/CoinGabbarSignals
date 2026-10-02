import { Router } from "express";
import { z } from "zod";
import type { Candle, ProviderResponse, Timeframe } from "../../shared/market.js";
import { BinanceMarketData } from "../engine/marketData.js";
import { SYMBOL_RE } from "../config/env.js";

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1H", "4H", "1D"] as const;

const querySchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(SYMBOL_RE),
  timeframe: z.enum(TIMEFRAMES).default("1H"),
  limit: z.coerce.number().int().min(10).max(1000).default(300),
});

const market = new BinanceMarketData();

// tiny cache so refreshes don't hammer Binance
const cache = new Map<string, { at: number; data: Candle[] }>();
const TTL_MS = 1500;

const router = Router();

router.get("/market/snapshot", async (req, res) => {
  const parsed = z.object({
    symbol: z.string().trim().toUpperCase().regex(SYMBOL_RE),
    timeframe: z.enum(TIMEFRAMES).default("1H"),
  }).safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "invalid_query",
        message: "Invalid symbol or timeframe",
      },
    });
    return;
  }

  const started = Date.now();

  try {
    const data = await market.getMarketSnapshot(
      parsed.data.symbol,
      parsed.data.timeframe,
    );

    res.json({
      data,
      meta: {
        sourceExchange: "binance",
        symbol: parsed.data.symbol,
        timeframe: parsed.data.timeframe,
        timestamp: Date.now(),
        latencyMs: Date.now() - started,
      },
    });
  } catch (err) {
    console.error("market snapshot error:", err);

    res.status(502).json({
      error: {
        code: "upstream_error",
        message: "Market data provider unavailable",
      },
    });
  }
});

router.get("/candles", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "invalid_query", message: "Invalid symbol, timeframe or limit" } });
    return;
  }
  const { symbol, timeframe, limit } = parsed.data;
  const key = `${symbol}|${timeframe}|${limit}`;
  const started = Date.now();

  try {
    const hit = cache.get(key);
    let data: Candle[];
    if (hit && started - hit.at < TTL_MS) {
      data = hit.data;
    } else {
      // MAX_SAFE_INTEGER => still-forming candle is INCLUDED (needed for live chart)
      data = await market.getCandles(symbol, timeframe as Timeframe, limit, Number.MAX_SAFE_INTEGER);
      cache.set(key, { at: started, data });
      if (cache.size > 200) cache.clear();
    }
    const body: ProviderResponse<Candle[]> = {
      data,
      meta: {
        sourceExchange: "binance",
        symbol,
        timestamp: Date.now(),
        timeframe: timeframe as Timeframe,
        dataQuality: { status: "fresh", ageMs: 0 },
        latencyMs: Date.now() - started,
      },
    };
    res.json(body);
  } catch (err) {
    console.error("candles error:", err);
    res.status(502).json({ error: { code: "upstream_error", message: "Market data provider unavailable" } });
  }
});

export default router;
