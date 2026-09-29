import { loadConfig } from "./config/env.js";
import { createApp } from "./app.js";

const config = loadConfig();
createApp(config).listen(config.port, config.host, () => {
  console.log(`[coingabbarsignals] ${config.appEnv} • default mode ${config.defaultMode} • http://${config.host}:${config.port}`);
});
