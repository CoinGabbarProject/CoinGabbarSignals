import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["src/**/*.{ts,tsx}"], languageOptions: { globals: globals.browser } },
  { files: ["server/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts", "*.config.{js,ts}"], languageOptions: { globals: globals.node } },
  {
    // Enforce frontend/backend separation: UI must never import server code, and vice versa.
    files: ["src/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["**/server/**"], message: "Frontend must not import server code. Use /shared contracts." }] }] },
  },
  {
    files: ["server/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["**/src/**"], message: "Server must not import frontend code. Use /shared contracts." }] }] },
  },
);
