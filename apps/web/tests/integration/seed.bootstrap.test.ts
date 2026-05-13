import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

function expectedFatherRole(): "viewer" | "operator" | "admin" {
  const raw = process.env.BOOTSTRAP_FATHER_ROLE?.trim().toLowerCase();
  if (raw === "viewer" || raw === "operator" || raw === "admin") {
    return raw;
  }
  return "operator";
}

/** Monorepo root (…/stay-ops-planner) from apps/web/tests/integration */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

describe("seed bootstrap users (after pnpm --filter @stay-ops/db seed in CI)", () => {
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const fatherEmail = process.env.BOOTSTRAP_FATHER_EMAIL?.trim();

  beforeAll(() => {
    if (!adminEmail || !fatherEmail) return;
    // Other integration suites TRUNCATE `users`; re-seed so this assertion stays meaningful in one Vitest run.
    execSync("pnpm --filter @stay-ops/db seed", {
      cwd: repoRoot,
      stdio: "pipe",
      env: process.env,
    });
  });

  it.skipIf(!adminEmail || !fatherEmail)(
    "upserts admin and father with roles from env",
    async () => {
      const admin = await prisma.user.findUnique({ where: { email: adminEmail! } });
      const father = await prisma.user.findUnique({ where: { email: fatherEmail! } });

      expect(admin).not.toBeNull();
      expect(father).not.toBeNull();
      expect(admin!.role).toBe("admin");
      expect(father!.role).toBe(expectedFatherRole());
    },
  );
});
