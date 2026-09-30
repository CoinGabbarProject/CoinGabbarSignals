import { loadConfig } from "./config/env.js";
import { createApp } from "./app.js";
import { connectMongoDB } from "./db/mongodb.js";

const config = loadConfig();

await connectMongoDB();

createApp(config).listen(config.port, config.host, () => {
  console.log(
    `[coingabbarsignals] ${config.appEnv} • http://${config.host}:${config.port}`
  );
});
