import type { CandlestickData, HistogramData, UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../../../shared/market.js";

/**
 * Adapter: shared/market.ts Candle  ->  Lightweight Charts data.
 *
 * Candle.timestamp is the candle OPEN time in epoch MILLISECONDS (see
 * server/engine/marketData.ts, Binance kline field [0]). Lightweight Charts wants
 * UTC epoch SECONDS. We floor-divide and never apply a timezone offset, so no
 * market time is shifted.
 *
 * The backend Candle schema is NOT changed for the chart library.
 */

export interface VolumeColors { up: string; down: string }

export interface AdaptedCandles {
  candles: CandlestickData<UTCTimestamp>[];
  /** Empty when no candle carries volume > 0. */
  volume: HistogramData<UTCTimestamp>[];
  hasVolume: boolean;
  /** Candles discarded because a field was non-finite or the time was invalid. */
  dropped: number;
}

export const msToChartTime = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp;

const isValid = (c: Candle): boolean =>
  Number.isFinite(c.timestamp) && c.timestamp > 0 &&
  Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close);

export function adaptCandles(input: readonly Candle[], volumeColors: VolumeColors): AdaptedCandles {
  const valid = input.filter(isValid);
  // Lightweight Charts throws unless times are strictly ascending and unique.
  const sorted = [...valid].sort((a, b) => a.timestamp - b.timestamp);

  const candles: CandlestickData<UTCTimestamp>[] = [];
  const volume: HistogramData<UTCTimestamp>[] = [];
  let lastTime = -Infinity;

  for (const c of sorted) {
    const time = msToChartTime(c.timestamp);
    if (time <= lastTime) continue; // duplicate bucket: keep the first
    lastTime = time;
    candles.push({ time, open: c.open, high: c.high, low: c.low, close: c.close });
    if (Number.isFinite(c.volume) && c.volume > 0) {
      volume.push({ time, value: c.volume, color: c.close >= c.open ? volumeColors.up : volumeColors.down });
    }
  }

  return { candles, volume, hasVolume: volume.length > 0, dropped: input.length - candles.length };
}
