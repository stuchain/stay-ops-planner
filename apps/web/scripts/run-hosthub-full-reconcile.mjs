/**
 * CLI: one Hosthub reconcile with fullSync (no incremental updated_gte watermark).
 * Loads repo-root `.env.hosthub.local` then `.env`.
 *
 * Run from apps/web (so workspace deps resolve):
 *   cd apps/web
 *   node ./scripts/run-hosthub-full-reconcile.mjs
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@stay-ops/db";
import { runHosthubReconcile } from "@stay-ops/sync";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
config({ path: path.join(repoRoot, ".env.hosthub.local") });
config({ path: path.join(repoRoot, ".env") });

const token = process.env.HOSTHUB_API_TOKEN?.trim();
if (!token) {
  console.error("HOSTHUB_API_TOKEN is required (e.g. in .env.hosthub.local)");
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  console.error("Starting runHosthubReconcile fullSync=true …");
  await runHosthubReconcile(prisma, { apiToken: token, fullSync: true });
  console.error("Done.");
} finally {
  await prisma.$disconnect();
}
