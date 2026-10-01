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
};

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
  };
}
