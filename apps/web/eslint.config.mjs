import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import boundaries from "eslint-plugin-boundaries";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  /**
   * Layer rules for the new code (docs/adr/0001-architecture.md):
   * ui is presentation only; features use ui and the api client; server never imports
   * the browser layers; nothing new imports the old `modules` UI.
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "import/resolver": { typescript: { project: "./tsconfig.json" } },
      "boundaries/include": ["src/**/*"],
      "boundaries/elements": [
        { type: "ui", pattern: "src/ui/**", mode: "full" },
        { type: "features", pattern: "src/features/**", mode: "full" },
        { type: "api-client", pattern: "src/api/**", mode: "full" },
        { type: "server", pattern: "src/server/**", mode: "full" },
        { type: "i18n", pattern: "src/i18n/**", mode: "full" },
        { type: "app", pattern: "src/app/**", mode: "full" },
        { type: "legacy", pattern: "src/{modules,lib,types}/**", mode: "full" },
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "allow",
          rules: [
            { from: "ui", disallow: ["features", "api-client", "server", "app", "legacy"], message: "src/ui is presentation only: it cannot import ${dependency.type}." },
            { from: "features", disallow: ["server", "app", "legacy"], message: "Features talk to the server through the api client, not ${dependency.type}." },
            { from: "api-client", disallow: ["server"], importKind: "value", message: "The api client may only import types from the server." },
            { from: "api-client", disallow: ["features", "ui", "app", "legacy"], message: "The api client cannot import ${dependency.type}." },
            { from: "server", disallow: ["ui", "features", "api-client", "app"], message: "Server code cannot import browser code (${dependency.type})." },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
