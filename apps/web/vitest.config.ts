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
          fileParallelism: false,
          hookTimeout: 30_000,
        },
      },
      {
        ...shared,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.tsx"],
          setupFiles: ["tests/unit/setup.ts"],
        },
      },
    ],
  },
});
