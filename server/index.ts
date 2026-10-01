import { loadConfig } from "./config/env.js";
import { createApp } from "./app.js";
import { connectMongoDB } from "./db/mongodb.js";
import { BinanceMarketData } from "./engine/marketData.js";
import { MongoSignalStore } from "./engine/mongoStore.js";
import { EngineService } from "./engine/scanner.js";

const config = loadConfig();

await connectMongoDB();

createApp(config).listen(config.port, config.host, () => {
  console.log(
    `[coingabbarsignals] ${config.appEnv} • http://${config.host}:${config.port}`
  );
});
