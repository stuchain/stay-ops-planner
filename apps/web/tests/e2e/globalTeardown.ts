import { execSync } from "node:child_process";
import path from "node:path";

async function globalTeardown() {
  const repoRoot = path.join(process.cwd(), "../..");
  try {
    execSync("corepack pnpm --filter @stay-ops/db cleanup:e2e", {
      cwd: repoRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        DATABASE_URL:
          process.env.DATABASE_URL ?? "postgresql://stayops:stayops@127.0.0.1:5432/stayops",
      },
    });
  } catch (error) {
    throw new Error(`E2E fixture cleanup failed. Verify DATABASE_URL and db access. Cause: ${String(error)}`);
  }
}

export default globalTeardown;
