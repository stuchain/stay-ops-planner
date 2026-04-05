import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: webRoot,
  resolve: {
    alias: {
      "@": path.resolve(webRoot, "src"),
    },
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".json"],
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Avoid Postgres deadlocks from concurrent TRUNCATE across files sharing one DB.
    fileParallelism: false,
    // BullMQ queue obliterate + worker hooks can exceed default 10s when Redis is cold.
    hookTimeout: 30_000,
  },
});
