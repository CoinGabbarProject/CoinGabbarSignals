/**
 * DEMO  – synthetic, deterministic data. No network, no keys, no DB required.
 * PAPER – real market data, simulated (virtual) execution and portfolios.
 * LIVE  – real market data, production signals. Production-only, explicitly confirmed.
 */
export const DATA_MODES = ["DEMO", "PAPER", "LIVE"] as const;
export type DataMode = (typeof DATA_MODES)[number];

export const APP_ENVS = ["development", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** Modes each environment is permitted to enable. */
export const ENV_ALLOWED_MODES: Record<AppEnv, readonly DataMode[]> = {
  development: ["DEMO", "PAPER"],
  staging: ["DEMO", "PAPER"],
  production: ["DEMO", "PAPER", "LIVE"],
};

export const LIVE_CONFIRM_PHRASE = "I_UNDERSTAND_LIVE_DATA";
