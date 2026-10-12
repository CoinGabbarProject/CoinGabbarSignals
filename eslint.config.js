import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["src/**/*.{ts,tsx}"], languageOptions: { globals: globals.browser } },
  { files: ["server/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts", "*.config.{js,ts}"], languageOptions: { globals: globals.node } },
  { files: ["header.js", "footer.js"], languageOptions: { globals: globals.browser } },
  {
    // Cleanup backlog: reported as warnings so they stay visible without blocking. Fix them, then change back to "error".
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "no-useless-assignment": "warn",
    },
  },
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
