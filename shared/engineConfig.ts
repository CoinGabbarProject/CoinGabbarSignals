/**
 * Engine settings - indicator periods and indicator on/off switches.
 *
 * Phase 1 of the backend Settings feature. Defaults reproduce the values that were
 * previously hard-coded, so passing no settings changes nothing.
 *
 * Not switchable on purpose: ATR (stops and targets depend on it) and the safety guards
 * (stale data, spread, invalid stop). Those are never turned off from settings.
 */

export interface IndicatorPeriods {
  emaFast: number;    // was EMA 20 (result field is still called ema20)
  emaSlow: number;    // was EMA 50 (result field is still called ema50)
  smaTrend: number;   // was SMA 200 (result field is still called sma200)
  rsi: number;
  atr: number;
  adx: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  bbPeriod: number;
  bbMult: number;
}

export interface IndicatorToggles {
  rsi: boolean;
  macd: boolean;
  stochRsi: boolean;
  obv: boolean;
  vwap: boolean;
  bollinger: boolean;
  derivatives: boolean;   // funding, open interest, long/short, top traders, taker flow
  orderBook: boolean;     // order-book imbalance (only counts while derivatives is on)
}

export interface EngineSettings {
  periods: IndicatorPeriods;
  toggles: IndicatorToggles;
}

/** What callers pass in: any subset. Missing fields fall back to the defaults. */
export interface EngineSettingsInput {
  periods?: Partial<IndicatorPeriods>;
  toggles?: Partial<IndicatorToggles>;
}

export const DEFAULT_PERIODS: Readonly<IndicatorPeriods> = Object.freeze({
  emaFast: 20, emaSlow: 50, smaTrend: 200,
  rsi: 14, atr: 14, adx: 14,
  macdFast: 12, macdSlow: 26, macdSignal: 9,
  bbPeriod: 20, bbMult: 2,
});

export const DEFAULT_TOGGLES: Readonly<IndicatorToggles> = Object.freeze({
  rsi: true, macd: true, stochRsi: true, obv: true, vwap: true,
  bollinger: true, derivatives: true, orderBook: true,
});

export const DEFAULT_ENGINE_SETTINGS: Readonly<EngineSettings> = Object.freeze({
  periods: DEFAULT_PERIODS,
  toggles: DEFAULT_TOGGLES,
});

/** Bump when the meaning of a setting changes. */
export const ENGINE_SETTINGS_SCHEMA = 1;

/** Fills in defaults. Does not validate: use validateEngineSettings() for user input. */
export function resolveEngineSettings(input?: EngineSettingsInput | null): EngineSettings {
  return {
    periods: { ...DEFAULT_PERIODS, ...(input?.periods ?? {}) },
    toggles: { ...DEFAULT_TOGGLES, ...(input?.toggles ?? {}) },
  };
}

type Range = { min: number; max: number; int: boolean };
const RANGES: Record<keyof IndicatorPeriods, Range> = {
  emaFast: { min: 2, max: 100, int: true },
  emaSlow: { min: 3, max: 200, int: true },
  smaTrend: { min: 20, max: 400, int: true },
  rsi: { min: 2, max: 50, int: true },
  atr: { min: 2, max: 50, int: true },
  adx: { min: 2, max: 50, int: true },
  macdFast: { min: 2, max: 50, int: true },
  macdSlow: { min: 3, max: 100, int: true },
  macdSignal: { min: 2, max: 50, int: true },
  bbPeriod: { min: 5, max: 100, int: true },
  bbMult: { min: 0.5, max: 5, int: false },
};

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  settings: EngineSettings;   // the resolved settings (only trust them when ok is true)
}

/** Strict validation for settings that come from a user or an API. */
export function validateEngineSettings(input?: EngineSettingsInput | null): ValidationResult {
  const errors: string[] = [];
  const raw = (input ?? {}) as { periods?: Record<string, unknown>; toggles?: Record<string, unknown> };
  const rawPeriods = raw.periods ?? {};
  const rawToggles = raw.toggles ?? {};

  for (const key of Object.keys(rawPeriods)) {
    if (!(key in RANGES)) { errors.push(`Unknown period setting: ${key}`); continue; }
    const r = RANGES[key as keyof IndicatorPeriods];
    const v = rawPeriods[key];
    if (typeof v !== "number" || !Number.isFinite(v)) errors.push(`${key} must be a number`);
    else if (r.int && !Number.isInteger(v)) errors.push(`${key} must be a whole number`);
    else if (v < r.min || v > r.max) errors.push(`${key} must be between ${r.min} and ${r.max}`);
  }
  for (const key of Object.keys(rawToggles)) {
    if (!(key in DEFAULT_TOGGLES)) errors.push(`Unknown indicator switch: ${key}`);
    else if (typeof rawToggles[key] !== "boolean") errors.push(`${key} must be true or false`);
  }

  const settings = resolveEngineSettings(input);
  const p = settings.periods;
  if (errors.length === 0) {
    if (!(p.emaFast < p.emaSlow)) errors.push("emaFast must be smaller than emaSlow");
    if (!(p.emaSlow < p.smaTrend)) errors.push("emaSlow must be smaller than smaTrend");
    if (!(p.macdFast < p.macdSlow)) errors.push("macdFast must be smaller than macdSlow");
  }
  return { ok: errors.length === 0, errors, settings };
}

/** Names of the indicators that are switched off, for reporting on a signal. */
export function disabledIndicators(t: IndicatorToggles): string[] {
  return (Object.keys(DEFAULT_TOGGLES) as (keyof IndicatorToggles)[]).filter((k) => !t[k]);
}

/** Fewest candles needed so every enabled period has real data. Equals 60 with the defaults. */
export function minCandlesFor(p: IndicatorPeriods): number {
  return Math.max(60, p.emaSlow + 10, p.macdSlow + p.macdSignal + 10, p.bbPeriod + 1, p.rsi + 2, p.atr + 2, p.adx * 2 + 2);
}
