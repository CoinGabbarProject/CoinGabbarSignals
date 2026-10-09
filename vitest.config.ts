import { defineConfig } from "vitest/config";

export default defineConfig({
   test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // old tests expect the old (gate-free) engine behaviour
    env: { ADX_MIN: "0", HTF_FILTER: "false", CANDLE_CONFIRM: "false", FIB_ENTRY: "false" },
  },
});
