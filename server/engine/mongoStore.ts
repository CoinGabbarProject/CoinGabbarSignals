import type { Db, Document } from "mongodb";
import type { FinalSignal } from "../models/signal.js";
import { TRACKABLE_STATUSES } from "./store.js";
import type { ScanSummary, SignalFilterStatus, SignalOutcome, SignalStore } from "./store.js";

// Separate collections from the legacy `signals` collection (its schema differs from FinalSignal).
type StrDoc = Document & { _id: string };
const strip = <T>(d: Document): T => { const { _id, ...rest } = d; void _id; return rest as unknown as T; };

export class MongoSignalStore implements SignalStore {
  constructor(private readonly db: Db) {}
  private latest = () => this.db.collection<StrDoc>("engine_latest");
  private signals = () => this.db.collection<StrDoc>("engine_signals");
  private runs = () => this.db.collection<Document>("engine_runs");

  async ensureIndexes(): Promise<void> {
    await this.signals().createIndex({ symbol: 1, "timeframe.primary": 1, status: 1 });
    await this.signals().createIndex({ "timestamps.createdAt": -1 });
    await this.latest().createIndex({ "timestamps.createdAt": -1 });
    await this.runs().createIndex({ finishedAt: -1 });
  }

  async saveLatest(s: FinalSignal): Promise<void> {
    await this.latest().replaceOne({ _id: `${s.symbol}:${s.timeframe.primary}` }, { _id: `${s.symbol}:${s.timeframe.primary}`, ...s }, { upsert: true });
  }
  async findActive(symbol: string, primaryTf: string): Promise<FinalSignal[]> {
    const docs = await this.signals().find({ symbol, "timeframe.primary": primaryTf, status: "ACTIVE" }).toArray();
    return docs.map((d) => strip<FinalSignal>(d));
  }
  async insertSignal(s: FinalSignal): Promise<void> {
    await this.signals().insertOne({ _id: s.id, ...s });
  }
  async setStatus(id: string, status: SignalFilterStatus, atIso: string): Promise<void> {
    await this.signals().updateOne({ _id: id }, { $set: { status, "timestamps.updatedAt": atIso, "timestamps.closedAt": atIso } });
  }
  async markEntered(id: string, atIso: string): Promise<void> {
    await this.signals().updateOne({ _id: id }, { $set: { entered: true, "timestamps.updatedAt": atIso } });
  }
  async listTrackable(): Promise<FinalSignal[]> {
    const docs = await this.signals()
      .find({ status: { $in: [...TRACKABLE_STATUSES] } })
      .toArray();
    return docs.map((d) => strip<FinalSignal>(d));
  }
  async setOutcome(id: string, o: SignalOutcome, atIso: string): Promise<void> {
    await this.signals().updateOne(
      { _id: id },
      {
        $set: {
          status: o.status,
          outcome: { status: o.status, exit: o.exit, closed: o.closed, at: atIso },
          "timestamps.updatedAt": atIso,
          "timestamps.closedAt": o.closed ? atIso : null,
        },
      },
    );
  }
  async recordRun(run: ScanSummary): Promise<void> { await this.runs().insertOne({ ...run }); }
  async lastRun(): Promise<ScanSummary | null> {
    const d = await this.runs().find().sort({ finishedAt: -1 }).limit(1).next();
    return d ? strip<ScanSummary>(d) : null;
  }
  async listLatest(f: { symbol?: string; direction?: FinalSignal["direction"]; limit: number }): Promise<FinalSignal[]> {
    const q: Document = {};
    if (f.symbol) q.symbol = f.symbol;
    if (f.direction) q.direction = f.direction;
    const docs = await this.latest().find(q).sort({ "timestamps.createdAt": -1 }).limit(f.limit).toArray();
    return docs.map((d) => strip<FinalSignal>(d));
  }
  async listHistory(f: { symbol?: string; status?: SignalFilterStatus; limit: number }): Promise<FinalSignal[]> {
    const q: Document = {};
    if (f.symbol) q.symbol = f.symbol;
    if (f.status) q.status = f.status;
    const docs = await this.signals().find(q).sort({ "timestamps.createdAt": -1 }).limit(f.limit).toArray();
    return docs.map((d) => strip<FinalSignal>(d));
  }
}
