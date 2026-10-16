import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "../shared/market.js";
import type { FinalSignal } from "../server/models/signal.js";
import type { MarketData } from "../server/engine/marketData.js";
import { MemorySignalStore } from "../server/engine/store.js";
import { tgSend, tgTiming, trackOutcomes } from "../server/engine/tracker.js";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 16, 7, 0);               // signal created
const NOW = T0 + 5 * 60 * MIN;
const quiet = { info: () => {}, warn: () => {}, error: () => {} };

const signal = (): FinalSignal => ({
  id: "s1", symbol: "APTUSDT", direction: "LONG", status: "ACTIVE", entered: true,
  timeframe: { primary: "15m", confirmation: "1H", execution: "5m" },
  entry: { min: 0.858, max: 0.861, ideal: 0.8603, trigger: "", expiry: new Date(T0 + 24 * 60 * MIN).toISOString() },
  stopLoss: { price: 0.84576, method: "ATR", reason: "" },
  takeProfit: { tp1: 0.88938, tp2: 0.90391, tp3: 0.93299 },
  timestamps: { createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0).toISOString(), closedAt: null },
} as unknown as FinalSignal);

// price enters the zone, then reaches TP1 (0.88938) but never TP2 or the stop
const candles = (): Candle[] => [0.8603, 0.866, 0.872, 0.8895, 0.885].map((c, i) => ({ timestamp: T0 + (i + 1) * 5 * MIN, open: c, high: c + 0.001, low: c - 0.001, close: c, volume: 1 }));
const market = { getCandles: async () => candles() } as unknown as MarketData;

async function setup() {
  const store = new MemorySignalStore();
  await store.insertSignal(signal());
  return store;
}
const run = (store: MemorySignalStore) => trackOutcomes({ market, store, now: () => NOW, log: quiet });
const tgBody = (call: unknown[]) => JSON.parse(String((call[1] as { body: string }).body)) as { text: string; parse_mode?: string };
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

beforeEach(() => {
  process.env["TELEGRAM_BOT_TOKEN"] = "T"; process.env["TELEGRAM_CHAT_ID"] = "C";
  tgTiming.gapMs = 0; tgTiming.retryMs = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env["TELEGRAM_BOT_TOKEN"]; delete process.env["TELEGRAM_CHAT_ID"]; });

describe("tgSend", () => {
  it("reports success only when Telegram accepts the message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok()));
    expect(await tgSend("hi")).toBe("sent");
  });
  it("is 'off' without a token and does not call Telegram", async () => {
    delete process.env["TELEGRAM_BOT_TOKEN"];
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    expect(await tgSend("hi")).toBe("off"); expect(f).not.toHaveBeenCalled();
  });
  it("no longer ignores HTTP errors: a bad token is reported as failed and logged", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 })); vi.stubGlobal("fetch", f);
    expect(await tgSend("hi")).toBe("failed");
    expect(f).toHaveBeenCalledTimes(1);                           // 401 is not retried
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 401 Unauthorized"));
  });
  it("retries after a 429 rate limit and then delivers", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ parameters: { retry_after: 0 } }), { status: 429 })).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", f);
    expect(await tgSend("hi")).toBe("sent"); expect(f).toHaveBeenCalledTimes(2);
  });
  it("retries network errors and 5xx", async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(new Response("{}", { status: 502 })).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", f);
    expect(await tgSend("hi")).toBe("sent"); expect(f).toHaveBeenCalledTimes(3);
  });
  it("resends as plain text when Telegram cannot parse the HTML", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ description: "Bad Request: can't parse entities" }), { status: 400 })).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", f);
    expect(await tgSend("<b>TP1</b> hit")).toBe("sent");
    const second = tgBody(f.mock.calls[1] as unknown[]);
    expect(second.parse_mode).toBeUndefined(); expect(second.text).toBe("TP1 hit");
  });
  it("sends one message at a time, in order", async () => {
    const order: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => { const t = (JSON.parse(init.body) as { text: string }).text; order.push("start " + t); await new Promise((r) => setTimeout(r, t === "a" ? 20 : 0)); order.push("end " + t); return ok(); }));
    await Promise.all([tgSend("a"), tgSend("b")]);
    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
  });
});

describe("tracker alerts", () => {
  it("sends the TP1 alert once and saves that it was delivered", async () => {
    const f = vi.fn(async () => ok()); vi.stubGlobal("fetch", f);
    const store = await setup();
    await run(store); await run(store); await run(store);
    expect(f).toHaveBeenCalledTimes(1);
    expect(tgBody(f.mock.calls[0] as unknown[]).text).toContain("TP1 HIT");
    expect(store.history.get("s1")!.status).toBe("TP1_HIT");
    expect(store.history.get("s1")!.outcome!.tg).toBe("TP1_HIT");
  });
  it("a failed alert is NOT lost: it is retried on the next run, then never repeated", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 500 })); vi.stubGlobal("fetch", f);
    const store = await setup();
    await run(store);
    expect(store.history.get("s1")!.status).toBe("TP1_HIT");        // the website still shows the hit
    expect(store.history.get("s1")!.outcome!.tg).toBe("ACTIVE");     // but the alert is still owed
    f.mockImplementation(async () => ok());
    const calls = f.mock.calls.length;
    await run(store);
    expect(f.mock.calls.length).toBe(calls + 1);
    expect(tgBody(f.mock.calls[calls] as unknown[]).text).toContain("TP1 HIT");
    expect(store.history.get("s1")!.outcome!.tg).toBe("TP1_HIT");
    await run(store);
    expect(f.mock.calls.length).toBe(calls + 1);                     // delivered once, no duplicates
  });
  it("gives up after a few runs when Telegram never accepts it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    const store = await setup();
    for (let i = 0; i < 8; i++) await run(store);
    expect(store.history.get("s1")!.outcome!.tg).toBe("TP1_HIT");
  });
  it("without a Telegram token the status still updates and nothing is sent", async () => {
    delete process.env["TELEGRAM_BOT_TOKEN"];
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const store = await setup();
    await run(store);
    expect(f).not.toHaveBeenCalled();
    expect(store.history.get("s1")!.status).toBe("TP1_HIT");
  });
  it("records created before this change (no marker) do not re-send old alerts", async () => {
    const f = vi.fn(async () => ok()); vi.stubGlobal("fetch", f);
    const store = new MemorySignalStore();
    const s = signal(); s.status = "TP1_HIT" as never;
    (s as unknown as { outcome: unknown }).outcome = { status: "TP1_HIT", exit: 0.88938, closed: false, at: new Date(T0).toISOString() };
    await store.insertSignal(s);
    await run(store);
    expect(f).not.toHaveBeenCalled();
  });
});
