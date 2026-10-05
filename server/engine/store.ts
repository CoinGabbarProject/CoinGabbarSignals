import type { FinalSignal } from "../models/signal.js";
import type { Timeframe } from "../../shared/market.js";

export type ScanOutcome = "emitted" | "duplicate" | "not_emitted" | "error";
export interface SymbolResult {
  symbol: string;
  direction: FinalSignal["direction"];
  score: number;
  outcome: ScanOutcome;
  error?: string;
}
export interface ScanSummary {
  startedAt: string; finishedAt: string; timeframe: Timeframe;
  scanned: number; emitted: number; errors: number; results: SymbolResult[];
}
export type SignalFilterStatus = "ACTIVE" | "CANCELLED" | "EXPIRED";
export interface SignalHits { tp1?: number; tp2?: number; tp3?: number; sl?: number }
export interface SignalOutcome {
  hits?: SignalHits;
  status: "TP1_HIT" | "TP2_HIT" | "TP3_HIT" | "SL_HIT" | "BE_HIT",
  exit: number;
  closed: boolean;
  trailStop?: number;
}
export const TRACKABLE_STATUSES = ["ACTIVE", "TP1_HIT", "TP2_HIT"] as const;

/** Persistence used by the scanner. Mongo in production, memory in tests/dev. */
export interface SignalStore {
  /** Newest scan result per symbol + primary timeframe (any direction, so WAIT/NO_TRADE is visible). */
  saveLatest(s: FinalSignal): Promise<void>;
  findActive(symbol: string, primaryTf: string): Promise<FinalSignal[]>;
  insertSignal(s: FinalSignal): Promise<void>;
  setStatus(id: string, status: SignalFilterStatus, atIso: string): Promise<void>;
  listTrackable(): Promise<FinalSignal[]>;
  setOutcome(id: string, outcome: SignalOutcome, atIso: string): Promise<void>;
  markEntered(id: string, atIso: string): Promise<void>;
  recordRun(run: ScanSummary): Promise<void>;
  lastRun(): Promise<ScanSummary | null>;
  listLatest(f: { symbol?: string; direction?: FinalSignal["direction"]; limit: number }): Promise<FinalSignal[]>;
  listHistory(f: { symbol?: string; status?: SignalFilterStatus; limit: number }): Promise<FinalSignal[]>;
}

const newest = (a: FinalSignal, b: FinalSignal): number => b.timestamps.createdAt.localeCompare(a.timestamps.createdAt);

export class MemorySignalStore implements SignalStore {
  latest = new Map<string, FinalSignal>();
  history = new Map<string, FinalSignal>();
  runs: ScanSummary[] = [];

  async saveLatest(s: FinalSignal): Promise<void> { this.latest.set(`${s.symbol}:${s.timeframe.primary}`, structuredClone(s)); }
  async findActive(symbol: string, primaryTf: string): Promise<FinalSignal[]> {
    return [...this.history.values()].filter((s) => s.symbol === symbol && s.timeframe.primary === primaryTf && (TRACKABLE_STATUSES as readonly string[]).includes(s.status)).map((s) => structuredClone(s));
  }
  async insertSignal(s: FinalSignal): Promise<void> { this.history.set(s.id, structuredClone(s)); }
  async setStatus(id: string, status: SignalFilterStatus, atIso: string): Promise<void> {
    const s = this.history.get(id);
    if (!s) return;
    s.status = status;
    s.timestamps.updatedAt = atIso;
    s.timestamps.closedAt = atIso;
  }
  async markEntered(id: string, atIso: string): Promise<void> {
    const s = this.history.get(id);
    if (!s) return;
    s.entered = true;
    s.timestamps.updatedAt = atIso;
  }
  async listTrackable(): Promise<FinalSignal[]> {
    return [...this.history.values()]
      .filter((s) => (TRACKABLE_STATUSES as readonly string[]).includes(s.status))
      .map((s) => structuredClone(s));
  }
  async setOutcome(id: string, o: SignalOutcome, atIso: string): Promise<void> {
    const s = this.history.get(id);
    if (!s) return;
    s.status = o.status;
    s.outcome = { status: o.status, exit: o.exit, closed: o.closed, at: atIso };
    s.timestamps.updatedAt = atIso;
    s.timestamps.closedAt = o.closed ? atIso : null;
  }
  async recordRun(run: ScanSummary): Promise<void> { this.runs.push(structuredClone(run)); }
  async lastRun(): Promise<ScanSummary | null> { return this.runs[this.runs.length - 1] ?? null; }
  async listLatest(f: { symbol?: string; direction?: FinalSignal["direction"]; limit: number }): Promise<FinalSignal[]> {
    return [...this.latest.values()].filter((s) => (!f.symbol || s.symbol === f.symbol) && (!f.direction || s.direction === f.direction)).sort(newest).slice(0, f.limit);
  }
  async listHistory(f: { symbol?: string; status?: SignalFilterStatus; limit: number }): Promise<FinalSignal[]> {
    return [...this.history.values()].filter((s) => (!f.symbol || s.symbol === f.symbol) && (!f.status || s.status === f.status)).sort(newest).slice(0, f.limit);
  }
}
