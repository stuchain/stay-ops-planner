import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

const shared = {
  root: webRoot,
  esbuild: { jsx: "automatic" as const },
  resolve: {
    alias: {
      "@": path.resolve(webRoot, "src"),
    },
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".json"],
  },
};

export default defineConfig({
  ...shared,
  test: {
    projects: [
      {
        ...shared,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          fileParallelism: false,
          /** Many suites TRUNCATE shared tables; avoid cross-file deadlocks on one DB. */
          maxWorkers: 1,
          /** One fork so TRUNCATE-heavy suites never race across files (Vitest may still parallelize files otherwise). */
          pool: "forks",
          poolOptions: {
            forks: { singleFork: true },
          },
          hookTimeout: 30_000,
        },
      },
      {
        ...shared,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
          setupFiles: ["tests/unit/setup.ts"],
        },
      },
    ],
  },
});
