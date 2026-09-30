import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";

import type { ServerConfig } from "./config/env.js";
import authRouter from "./routes/auth.js";

export function createApp(config: ServerConfig): Express {
  const app = express();

  app.disable("x-powered-by");

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
