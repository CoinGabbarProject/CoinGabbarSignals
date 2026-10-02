import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Frontend is a static SPA served independently of the API server.
export default defineConfig({
base: "./",
  plugins: [react()],
  build: { outDir: "dist/web", sourcemap: true },
  server: { port: 5173 },
});
