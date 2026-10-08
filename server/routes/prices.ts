import { Router } from "express";

/**
 * Live prices for the Recent Signals cards.
 * The page used to call OKX straight from the phone. Some networks (for example a few Indian ISPs)
 * block okx.com, so every card showed "—". Now the server fetches the prices and the page reads them here.
 */

const OKX_TICKERS = "https://www.okx.com/api/v5/market/tickers";
const TTL_MS = 3000;
const MAX_SYMBOLS = 100;

type PriceMap = Record<string, number>;

let cache: { at: number; data: PriceMap } | null = null;
let inflight: Promise<PriceMap> | null = null;

async function pull(type: "SWAP" | "SPOT"): Promise<PriceMap> {
  const res = await fetch(`${OKX_TICKERS}?instType=${type}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`OKX ${type} HTTP ${res.status}`);

  const body = (await res.json()) as { data?: { instId?: string; last?: string }[] };
  const out: PriceMap = {};
  for (const r of body.data ?? []) {
    const m = /^(.+)-USDT(-SWAP)?$/.exec(r.instId ?? "");
    const p = Number(r.last);
    if (m && Number.isFinite(p) && p > 0) out[`${m[1]}USDT`] = p;
  }
  return out;
}

async function load(): Promise<PriceMap> {
  const [swap, spot] = await Promise.allSettled([pull("SWAP"), pull("SPOT")]);
  if (swap.status === "rejected" && spot.status === "rejected") throw new Error("OKX unavailable");
  return {
    ...(spot.status === "fulfilled" ? spot.value : {}),
    ...(swap.status === "fulfilled" ? swap.value : {}), // futures price wins, same as before
  };
}

const router = Router();

router.get("/prices", async (req, res) => {
  const wanted = String(req.query.symbols ?? "")
    .toUpperCase()
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Z0-9]{3,20}$/.test(s))
    .slice(0, MAX_SYMBOLS);

  const pick = (all: PriceMap): PriceMap => {
    if (wanted.length === 0) return all;
    const out: PriceMap = {};
    for (const s of wanted) if (all[s] !== undefined) out[s] = all[s];
    return out;
  };

  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      inflight ??= load().finally(() => {
        inflight = null;
      });
      cache = { at: Date.now(), data: await inflight };
    }
    res.json({ data: pick(cache.data), meta: { sourceExchange: "okx", timestamp: cache.at } });
  } catch (err) {
    console.error("prices error:", err);
    if (cache) {
      res.json({ data: pick(cache.data), meta: { sourceExchange: "okx", timestamp: cache.at, stale: true } });
      return;
    }
    res.status(502).json({ error: { code: "upstream_error", message: "Price provider unavailable" } });
  }
});

export default router;
