import { describe, expect, it } from "vitest";
import type { Candle } from "../shared/market.js";
import { validateCandles } from "../src/market/validateCandles.js";
import { normalizeSymbol, displaySymbol } from "../src/market/symbol.js";
import { isTimeframe } from "../src/market/timeframes.js";

const k = (timestamp: number, open: number, high: number, low: number, close: number, volume = 1): Candle => ({ timestamp, open, high, low, close, volume });

describe("validateCandles", () => {
  it("rejects impossible OHLC and malformed rows", () => {
    const r = validateCandles([k(1, 10, 9, 8, 9), k(2, 10, 12, 11, 11), k(3, 10, 12, 9, 11), k(0, 1, 1, 1, 1), k(4, NaN, 1, 1, 1), k(5, 0, 1, 0, 1)]);
    expect(r.candles.map((c) => c.timestamp)).toEqual([3]);
    expect(r.rejected).toBe(5);
  });
  it("accepts boundary-equal candles (doji, flat)", () => {
    expect(validateCandles([k(1, 5, 5, 5, 5), k(2, 5, 6, 4, 5)]).candles).toHaveLength(2);
  });
  it("sorts and keeps the LAST duplicate deterministically, prices untouched", () => {
    const r = validateCandles([k(2, 1, 2, 1, 2), k(1, 1, 2, 1, 1.5), k(2, 1, 3, 1, 2.5)]);
    expect(r.candles.map((c) => [c.timestamp, c.close])).toEqual([[1, 1.5], [2, 2.5]]);
    expect(r.rejected).toBe(1);
  });
  it("zeroes a bad volume without dropping or altering prices; never invents candles", () => {
    const r = validateCandles([k(1, 1, 2, 1, 2, NaN)]);
    expect(r.candles[0]).toMatchObject({ open: 1, high: 2, low: 1, close: 2, volume: 0 });
    expect(validateCandles([])).toEqual({ candles: [], rejected: 0 });
  });
});

describe("normalizeSymbol", () => {
  it("normalizes common forms to the exchange symbol", () => {
    for (const s of ["BTC", "btc", "BTC-USDT", "btc/usdt", "BTCUSDT"]) expect(normalizeSymbol(s)).toBe("BTCUSDT");
    expect(normalizeSymbol("DOGE")).toBe("DOGEUSDT");
    expect(normalizeSymbol("trx")).toBe("TRXUSDT");
  });
  it("returns null for non-pairs", () => {
    for (const s of ["", "USDT", null, undefined, "BT!C"]) expect(normalizeSymbol(s)).toBeNull();
  });
  it("formats for display", () => expect(displaySymbol("ETHUSDT")).toBe("ETH/USDT"));
  it("recognises only supported timeframes", () => {
    expect(isTimeframe("1H")).toBe(true);
    expect(isTimeframe("1h")).toBe(false);
  });
});
