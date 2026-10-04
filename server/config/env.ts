import type { Timeframe } from "../../shared/market.js";

export type ScanConfig = {
  enabled: boolean;
  intervalMs: number;
  symbols: string[];
  timeframe: Timeframe;
  minScore: number;
  concurrency: number;
  spotUrl: string;
  futuresUrl: string;
};

export type ServerConfig = {
  port: number;
  host: string;
  appEnv: string;
  defaultMode: string;
  corsOrigins: string[];
  scan: ScanConfig;
};

const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "30m", "1H", "4H", "1D"];
export const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;

const clampInt = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && raw !== undefined && raw !== "" ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
};

export function loadScanConfig(env: NodeJS.ProcessEnv = process.env): ScanConfig {
  const symbols = (env.SCAN_SYMBOLS || "BTCUSDT,ETHUSDT,XRPUSDT,BNBUSDT,SOLUSDT,DOGEUSDT,ADAUSDT,TRXUSDT,LINKUSDT,AVAXUSDT,SUIUSDT,XLMUSDT,BCHUSDT,HBARUSDT,LTCUSDT,TONUSDT,DOTUSDT,UNIUSDT,AAVEUSDT,NEARUSDT")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const bad = symbols.find((s) => !SYMBOL_RE.test(s));
  if (bad) throw new Error(`SCAN_SYMBOLS contains an invalid symbol: ${bad}`);
  if (symbols.length === 0 || symbols.length > 50) throw new Error("SCAN_SYMBOLS must list 1-50 symbols");

  const tf = (env.SCAN_TIMEFRAME || "1H") as Timeframe;
  if (!TIMEFRAMES.includes(tf)) throw new Error(`SCAN_TIMEFRAME must be one of ${TIMEFRAMES.join(", ")}`);

  return {
    enabled: ["1", "true", "yes"].includes((env.AUTO_SCAN_ENABLED || "").toLowerCase()),
    intervalMs: clampInt(env.SCAN_INTERVAL_MS, 300_000, 60_000, 86_400_000),
    symbols: [...new Set(symbols)],
    timeframe: tf,
    minScore: clampInt(env.SCAN_MIN_SCORE, 75, 0, 100),
    concurrency: clampInt(env.SCAN_CONCURRENCY, 4, 1, 5),
    spotUrl: env.BINANCE_SPOT_URL || "https://data-api.binance.vision",
    futuresUrl: env.BINANCE_FUTURES_URL || "https://fapi.binance.com",
  };
}

export function loadConfig(): ServerConfig {
  return {
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || "0.0.0.0",
    appEnv: process.env.NODE_ENV || "development",
    defaultMode: process.env.DEFAULT_MODE || "demo",
    corsOrigins: (process.env.CORS_ORIGINS || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    scan: loadScanConfig(),
  };
}
