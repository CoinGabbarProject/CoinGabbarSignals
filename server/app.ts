import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { ServerConfig } from "./config/env.js";
import { metaRouter } from "./routes/meta.js";
import type { ApiError } from "../shared/api.js";
import { ZodError } from "zod";
import { log } from "./lib/logger.js";
import { marketRouter } from "./routes/market.js";
import { signalRouter } from "./routes/signals.js";
import {toolsRouter} from "./routes/tools.js";
import {adminRouter} from "./routes/admin.js";
import authRouter from "./routes/auth.js";
import {securityHeaders,rateLimit} from "./middleware/security.js";

export function createApp(config: ServerConfig): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(securityHeaders); app.use(rateLimit());

  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => log("info", "http_request", { method: req.method, path: req.path, status: res.statusCode, latencyMs: Date.now() - started }));
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    next();
  });

  app.use("/api/v1", metaRouter(config));
  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok", uptimeSeconds: Math.floor(process.uptime()) }));
  app.use("/api/v1", marketRouter());
  app.use("/api/v1", signalRouter());
  app.use("/api/v1", toolsRouter());
  app.use("/api/v1", adminRouter());

  app.use((_req, res) => {
    const body: ApiError = { error: { code: "not_found", message: "Route not found" } };
    res.status(404).json(body);
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      const body: ApiError = { error: { code: "validation_error", message: err.issues.map((x) => x.message).join("; ") } };
      res.status(400).json(body);
      return;
    }
    log("error", "http_error", { error: err instanceof Error ? err.message : String(err) });
    const body: ApiError = { error: { code: "internal_error", message: "Internal server error" } };
    res.status(500).json(body);
  });
  return app;
}
