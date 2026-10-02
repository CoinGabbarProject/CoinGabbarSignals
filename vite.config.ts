import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Frontend is a static SPA served independently of the API server.
export default defineConfig({
base: "./",
  plugins: [react()],
build: {
    outDir: "dist/web",
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        backend: resolve(__dirname, "backend.html"),
      },
    },
  },
  server: { port: 5173 },
});
