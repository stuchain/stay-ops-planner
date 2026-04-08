import { execSync } from "node:child_process";
import path from "node:path";

async function globalTeardown() {
  const repoRoot = path.join(process.cwd(), "../..");
  try {
    const out = execSync("corepack pnpm --filter @stay-ops/db cleanup:e2e", {
      cwd: repoRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        DATABASE_URL:
          process.env.DATABASE_URL ?? "postgresql://stayops:stayops@127.0.0.1:5432/stayops",
      },
    });
    const msg = out.toString("utf8").trim();
    if (msg) {
      console.log(`globalTeardown cleanup:e2e completed: ${msg}`);
    }
  } catch (error) {
    throw new Error(
      `E2E fixture cleanup failed (includes R1/E2E room cleanup). Verify DATABASE_URL and db access. Cause: ${String(error)}`,
    );
  }
}

export default globalTeardown;
