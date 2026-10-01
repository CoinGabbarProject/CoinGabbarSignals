import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";

import type { ServerConfig } from "./config/env.js";
import authRouter from "./routes/auth.js";
import signalsRouter from "./routes/signals.js";
import candlesRouter from "./routes/candles.js";
import { createEngineRouter } from "./routes/engine.js";
import type { EngineService } from "./engine/scanner.js";
import type { SignalStore } from "./engine/store.js";

export interface AppDeps { engine?: EngineService; store?: SignalStore }

export function createApp(config: ServerConfig, deps: AppDeps = {}): Express {
  const app = express();

  app.disable("x-powered-by");

  // CORS (frontend on GitHub Pages -> API on Render)
  const allowedOrigins = config.corsOrigins.length
    ? config.corsOrigins
    : ["https://coingabbarproject.github.io"];

  app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
      );
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    return next();
  });

  app.use(express.json({ limit: "100kb" }));

  // Health check
  app.get("/api/v1/health", (_req, res) => {
    res.json({
      status: "ok",
      database: "connected",
    });
  });

  // Admin login
  app.use("/api/v1", authRouter);
  app.use("/api/v1", signalsRouter);
  app.use("/api/v1", candlesRouter);
  if (deps.engine && deps.store) app.use("/api/v1", createEngineRouter(deps.engine, deps.store));

  // 404
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: "not_found",
        message: "Route not found",
      },
    });
  });

  // Error handler
  app.use(
    (
      err: unknown,
      _req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      console.error("Server error:", err);

      res.status(500).json({
        error: {
          code: "internal_error",
          message: "Internal server error",
        },
      });
    }
  );

  return app;
}
