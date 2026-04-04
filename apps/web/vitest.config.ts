import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Avoid Postgres deadlocks from concurrent TRUNCATE across files sharing one DB.
    fileParallelism: false,
  },
});

