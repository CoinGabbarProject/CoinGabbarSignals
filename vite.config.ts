import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend is a static SPA served independently of the API server.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/web", sourcemap: true },
  server: { port: 5173 },
});
