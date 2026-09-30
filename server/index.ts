import { loadConfig } from "./config/env.js";
import { createApp } from "./app.js";

import { connectMongoDB } from "./db/mongodb.js";
import { loadConfig } from "./config/env.js";
import { createApp } from "./app.js";

const config = loadConfig();

await connectMongoDB();

createApp(config).listen(config.port, config.host, () => {
  console.log(
    `[coingabbarsignals] ${config.appEnv} • http://${config.host}:${config.port}`
  );
});
  console.log(`[coingabbarsignals] ${config.appEnv} • default mode ${config.defaultMode} • http://${config.host}:${config.port}`);
});
