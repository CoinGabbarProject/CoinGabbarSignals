/**
 * Indicator combination presets.
 *
 * A preset is only a starting point for the existing engine settings (periods + on/off switches).
 * Selecting one fills the form; nothing changes in the live engine until the settings go through
 * the normal Check -> Save draft -> Activate flow (admin only).
 *
 * Rules kept here on purpose:
 *  - No "quality score" is derived from how many indicators are on.
 *  - Correlated indicators are grouped into evidence FAMILIES. A family counts as one kind of
 *    evidence, never as several independent confirmations.
 *  - Safety checks (stale data, spread, valid stop-loss, ATR) are not switchable, so presets cannot touch them.
 *  - Unavailable data (null / missing) is never the same as a real zero.
 */
import { DEFAULT_PERIODS, DEFAULT_TOGGLES, resolveEngineSettings, validateEngineSettings } from "./engineConfig.js";
import type { EngineSettings, EngineSettingsInput, IndicatorPeriods, IndicatorToggles } from "./engineConfig.js";

export type PresetStatus = "builtin" | "saved" | "archived";
export type DataRequirement = "derivatives" | "orderBook";

export interface IndicatorPreset {
  id: string;
  name: string;
  description: string;
  version: number;
  createdBy: string;
  createdAt: string;
  status: PresetStatus;
  settings: EngineSettings;                 // full, resolved values
  required: (keyof IndicatorToggles)[];     // indicators this preset cannot work without
}

export const MAX_PRESET_NAME = 60;
export const MAX_PRESET_DESCRIPTION = 200;
const BUILTIN_CREATED_AT = "2026-10-15T00:00:00.000Z";

const only = (on: (keyof IndicatorToggles)[]): IndicatorToggles => {
  const t = { ...DEFAULT_TOGGLES } as Record<keyof IndicatorToggles, boolean>;
  for (const k of Object.keys(t) as (keyof IndicatorToggles)[]) t[k] = on.includes(k);
  return t;
};

function builtin(id: string, name: string, description: string, on: (keyof IndicatorToggles)[], required: (keyof IndicatorToggles)[], periods: Partial<IndicatorPeriods> = {}): IndicatorPreset {
  return {
    id, name, description, version: 1, createdBy: "system", createdAt: BUILTIN_CREATED_AT, status: "builtin",
    settings: { periods: { ...DEFAULT_PERIODS, ...periods }, toggles: only(on) }, required,
  };
}

/** The six built-in presets. Frozen: nobody can edit them, only copy them. */
export const BUILTIN_PRESETS: readonly IndicatorPreset[] = Object.freeze([
  builtin("trend-sr", "Trend + Support/Resistance", "EMA/SMA trend with MACD and VWAP direction, scored against swing-pivot levels.",
    ["macd", "vwap", "pivots"], ["pivots"]),
  builtin("momentum-confirmation", "Momentum Confirmation", "RSI, Stochastic RSI and MACD momentum with OBV volume confirmation.",
    ["rsi", "macd", "stochRsi", "obv"], ["rsi", "macd"]),
  builtin("breakout-volatility", "Breakout + Volatility", "Bollinger Band expansion with OBV/VWAP volume and pivot levels.",
    ["bollinger", "obv", "vwap", "pivots"], ["bollinger"], { bbPeriod: 20, bbMult: 2 }),
  builtin("derivatives-liquidity", "Derivatives + Liquidity", "Funding, open interest, long/short and order-book data with liquidation clusters.",
    ["derivatives", "orderBook", "liquidation", "obv", "vwap"], ["derivatives", "orderBook", "liquidation"]),
  builtin("smart-money-structure", "Smart Money + Market Structure", "Order blocks, FVG and sweeps (SMC) with swing-pivot structure and liquidation clusters.",
    ["smc", "pivots", "liquidation", "vwap"], ["smc", "pivots"]),
  builtin("range-reversal", "Range + Reversal", "RSI/Stochastic RSI extremes at Bollinger edges, VWAP and pivot levels.",
    ["rsi", "stochRsi", "bollinger", "vwap", "pivots"], ["rsi", "bollinger"]),
]);

/** Indicators that measure largely the same thing. They are one family of evidence, not independent votes. */
export const CORRELATION_FAMILIES: { id: string; label: string; members: (keyof IndicatorToggles)[] }[] = [
  { id: "momentum", label: "Momentum oscillators", members: ["rsi", "stochRsi", "macd"] },
  { id: "volume-price", label: "Volume / price-weighted", members: ["obv", "vwap"] },
  { id: "volatility", label: "Volatility bands", members: ["bollinger"] },
  { id: "levels", label: "Price levels / structure", members: ["pivots", "smc", "liquidation"] },
  { id: "derivatives-flow", label: "Derivatives / order flow", members: ["derivatives", "orderBook"] },
];

export const INDICATOR_LABELS: Record<keyof IndicatorToggles, string> = {
  rsi: "RSI", macd: "MACD", stochRsi: "Stochastic RSI", obv: "OBV", vwap: "VWAP", bollinger: "Bollinger Bands",
  derivatives: "Derivatives data", orderBook: "Order book", pivots: "Swing pivots (S/R)", smc: "SMC zones", liquidation: "Liquidation clusters",
};

/** The checks that can never be switched off by any preset or setting. */
export const MANDATORY_SAFETY_CHECKS = ["Stale-data check", "Spread check", "Valid stop-loss check", "ATR-based stop and targets"] as const;

const toggleKeys = Object.keys(DEFAULT_TOGGLES) as (keyof IndicatorToggles)[];
const periodKeys = Object.keys(DEFAULT_PERIODS) as (keyof IndicatorPeriods)[];

export function getBuiltinPreset(id: string): IndicatorPreset | undefined {
  const p = BUILTIN_PRESETS.find((x) => x.id === id);
  return p ? clonePreset(p) : undefined;
}

export function clonePreset(p: IndicatorPreset): IndicatorPreset {
  return { ...p, settings: { periods: { ...p.settings.periods }, toggles: { ...p.settings.toggles } }, required: [...p.required] };
}

/** Settings a preset puts into the form. Always a fresh copy, so editing the form can never change the preset. */
export function applyPreset(p: IndicatorPreset): EngineSettings {
  return { periods: { ...p.settings.periods }, toggles: { ...p.settings.toggles } };
}

/** Plain-language summary of a settings object, shown before saving. It deliberately has no score. */
export interface IndicatorSummary {
  enabled: string[];
  disabled: string[];
  families: { id: string; label: string; enabled: string[]; note: string }[];
  dataNeeded: DataRequirement[];
  safety: readonly string[];
  notes: string[];
}

export function summarizeSettings(input: EngineSettingsInput | null | undefined): IndicatorSummary {
  const s = resolveEngineSettings(input);
  const enabled = toggleKeys.filter((k) => s.toggles[k]).map((k) => INDICATOR_LABELS[k]);
  const disabled = toggleKeys.filter((k) => !s.toggles[k]).map((k) => INDICATOR_LABELS[k]);
  const families = CORRELATION_FAMILIES
    .map((f) => {
      const on = f.members.filter((m) => s.toggles[m]).map((m) => INDICATOR_LABELS[m]);
      return { id: f.id, label: f.label, enabled: on, note: on.length > 1 ? "Correlated: counts as one kind of evidence, not independent confirmation." : "" };
    })
    .filter((f) => f.enabled.length > 0);
  const dataNeeded: DataRequirement[] = [];
  if (s.toggles.derivatives) dataNeeded.push("derivatives");
  if (s.toggles.derivatives && s.toggles.orderBook) dataNeeded.push("orderBook");
  const notes = [
    "The number of enabled indicators is not a measure of signal quality.",
    "Switching indicators off lowers the maximum score and the score is rescaled to 100.",
  ];
  if (dataNeeded.length) notes.push("Derivatives / order-book data must be available, fresh and from a known source, otherwise no tradable signal is produced.");
  return { enabled, disabled, families, dataNeeded, safety: MANDATORY_SAFETY_CHECKS, notes };
}

/** Warnings for a form state, relative to the preset it started from. */
export function presetWarnings(p: Pick<IndicatorPreset, "name" | "required">, input: EngineSettingsInput | null | undefined): string[] {
  const s = resolveEngineSettings(input);
  const out: string[] = [];
  for (const k of p.required) {
    if (!s.toggles[k]) out.push(`${INDICATOR_LABELS[k]} is required by "${p.name}" but is switched off.`);
  }
  if (s.toggles.orderBook && !s.toggles.derivatives) out.push("Order book only counts while Derivatives data is on, so it has no effect right now.");
  return out;
}

export interface SettingsDiff {
  toggles: { key: keyof IndicatorToggles; label: string; a: boolean; b: boolean }[];
  periods: { key: keyof IndicatorPeriods; a: number; b: number }[];
  same: boolean;
}

/** Which indicators and parameters differ between two settings objects. */
export function diffSettings(a: EngineSettingsInput | null | undefined, b: EngineSettingsInput | null | undefined): SettingsDiff {
  const x = resolveEngineSettings(a), y = resolveEngineSettings(b);
  const toggles = toggleKeys.filter((k) => x.toggles[k] !== y.toggles[k]).map((k) => ({ key: k, label: INDICATOR_LABELS[k], a: x.toggles[k], b: y.toggles[k] }));
  const periods = periodKeys.filter((k) => x.periods[k] !== y.periods[k]).map((k) => ({ key: k, a: x.periods[k], b: y.periods[k] }));
  return { toggles, periods, same: toggles.length === 0 && periods.length === 0 };
}

export function validatePresetName(name: unknown): string[] {
  if (typeof name !== "string" || name.trim() === "") return ["name is required"];
  if (name.trim().length > MAX_PRESET_NAME) return [`name must be at most ${MAX_PRESET_NAME} characters`];
  return [];
}

export function validatePresetDescription(d: unknown): string[] {
  if (d === undefined) return [];
  if (typeof d !== "string") return ["description must be text"];
  return d.length > MAX_PRESET_DESCRIPTION ? [`description must be at most ${MAX_PRESET_DESCRIPTION} characters`] : [];
}

/** Full check of a preset's parameters against the configured minimum and maximum values. */
export function validatePresetSettings(input: unknown): { ok: boolean; errors: string[]; settings: EngineSettings } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["settings must be an object with periods and/or toggles"], settings: resolveEngineSettings() };
  }
  const extra = Object.keys(input).filter((k) => k !== "periods" && k !== "toggles").map((k) => `Unknown settings section: ${k}`);
  const r = validateEngineSettings(input as EngineSettingsInput);
  return { ok: extra.length === 0 && r.ok, errors: [...extra, ...r.errors], settings: r.settings };
}

/**
 * Derivatives / order-book data check. Null or missing = UNAVAILABLE, which is not the same as a real 0
 * (a funding rate of exactly 0 is valid data). Also needs a known source and a fresh timestamp.
 */
export interface DerivativesData {
  fundingRate?: number | null; oiChangePct?: number | null; longShortRatio?: number | null; bookImbalance?: number | null;
  asOf?: number | null;      // when the data was fetched (ms)
  source?: string | null;    // which exchange / feed it came from
}
export type FieldState = "ok" | "unavailable";
export interface DataAssessment {
  ok: boolean;
  reasons: string[];
  fields: Record<"fundingRate" | "oiChangePct" | "longShortRatio" | "bookImbalance", FieldState>;
}

export function assessDerivativesData(d: DerivativesData | null | undefined, need: readonly DataRequirement[], now: number, maxAgeMs: number): DataAssessment {
  const real = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
  const fields = {
    fundingRate: real(d?.fundingRate) ? "ok" : "unavailable",
    oiChangePct: real(d?.oiChangePct) ? "ok" : "unavailable",
    longShortRatio: real(d?.longShortRatio) ? "ok" : "unavailable",
    bookImbalance: real(d?.bookImbalance) ? "ok" : "unavailable",
  } as DataAssessment["fields"];
  const reasons: string[] = [];
  if (need.length === 0) return { ok: true, reasons, fields };
  if (!d) return { ok: false, reasons: ["Derivatives data is unavailable"], fields };
  if (need.includes("derivatives")) {
    for (const k of ["fundingRate", "oiChangePct", "longShortRatio"] as const) if (fields[k] !== "ok") reasons.push(`${k} is unavailable`);
  }
  if (need.includes("orderBook") && fields.bookImbalance !== "ok") reasons.push("Order-book data is unavailable");
  if (typeof d.source !== "string" || d.source.trim() === "") reasons.push("Derivatives data has no known source");
  if (!real(d.asOf)) reasons.push("Derivatives data has no timestamp, so freshness cannot be checked");
  else if (now - (d.asOf as number) > maxAgeMs) reasons.push("Derivatives data is stale");
  else if ((d.asOf as number) - now > 60_000) reasons.push("Derivatives data timestamp is in the future");
  return { ok: reasons.length === 0, reasons, fields };
}

/**
 * What a backtest can honestly say about a settings object. Backtests replay candles only, so
 * derivatives, order book and liquidations are never replayed. A preset that uses them is NOT fully backtested.
 */
export function backtestCaveats(input: EngineSettingsInput | null | undefined): string[] {
  const s = resolveEngineSettings(input);
  const out: string[] = [];
  if (s.toggles.derivatives || s.toggles.orderBook) out.push("Derivatives and order-book data are not replayed in backtests.");
  if (s.toggles.liquidation) out.push("Liquidation clusters are not replayed in backtests.");
  return out;
  }
