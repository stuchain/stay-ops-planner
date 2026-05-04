import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "prisma/migrations/**",
      "prisma/seed.ts",
      "prisma/seed-e2e.ts",
      // Lives outside the `src/` rootDir of `tsconfig.json` and is loaded
      // ad-hoc by the seed runners; not worth wiring into the project graph
      // just for two `dotenv.config()` calls.
      "prisma/load-env.ts",
    ],
  },
);
