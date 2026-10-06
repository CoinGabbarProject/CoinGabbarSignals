import { loadConfig } from "./config/env.js";
import { createApp } from "./app.js";
import { connectMongoDB } from "./db/mongodb.js";
import { createMarketData } from "./engine/okxMarketData.js";
import { MongoSignalStore } from "./engine/mongoStore.js";
import { EngineService } from "./engine/scanner.js";

const config = loadConfig();

const db = await connectMongoDB();

const store = new MongoSignalStore(db);
await store.ensureIndexes();

const engine = new EngineService(
  {
    market: createMarketData({ spotUrl: config.scan.spotUrl, futuresUrl: config.scan.futuresUrl, timeoutMs: 8000 }),
    store,
    exchange: "binance",
  },
  {
    symbols: config.scan.symbols,
    timeframe: config.scan.timeframe,
    minScore: config.scan.minScore,
    concurrency: config.scan.concurrency,
    candleLimit: 300,
  },
);

engine.startTracker(10_000);

const selfUrl = process.env.RENDER_EXTERNAL_URL;
if (selfUrl) {
  setInterval(() => {
    fetch(`${selfUrl}/api/v1/health`).catch(() => {});
  }, 4 * 60 * 1000).unref();
}

if (config.scan.enabled) {
  engine.start(config.scan.intervalMs);
  console.log(`[engine] auto-scan every ${Math.round(config.scan.intervalMs / 1000)}s: ${config.scan.symbols.join(",")} ${config.scan.timeframe}`);
} else {
  console.log("[engine] auto-scan disabled (set AUTO_SCAN_ENABLED=true to enable)");
}

const server = createApp(config, { engine, store }).listen(config.port, config.host, () => {
  console.log(
    `[coingabbarsignals] ${config.appEnv} • http://${config.host}:${config.port}`
  );
});
const shutdown = (): void => {
  engine.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
