import type { AppEnv, DataMode } from "./dataMode.js";

export interface HealthResponse {
  status: "ok";
  uptimeSeconds: number;
}

export interface MetaResponse {
  app: "CoinGabbarSignals";
  apiVersion: "v1";
  env: AppEnv;
  defaultMode: DataMode;
  allowedModes: DataMode[];
}

export interface ApiError {
  error: { code: string; message: string };
}
