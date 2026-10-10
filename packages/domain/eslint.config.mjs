import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
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
      // The domain is pure: no I/O, no framework, no database.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@prisma/*", "@stay-ops/db", "@stay-ops/web", "next", "next/*", "react", "node:*"], message: "packages/domain is pure TypeScript: it may only import zod." },
          ],
        },
      ],
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "vitest.config.ts", "**/*.test.ts", "coverage/**"],
  },
);
