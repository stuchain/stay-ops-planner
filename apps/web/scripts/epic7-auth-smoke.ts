/**
 * Epic 7 manual smoke (no dev server): lockout + cookie payload + simulated middleware refresh.
 *
 * Run from repo root:
 *   corepack pnpm --filter @stay-ops/db exec tsx ../apps/web/scripts/epic7-auth-smoke.ts
 *
 * Requires DATABASE_URL (e.g. from repo `.env`). Clears `login_attempts` for the smoke email only.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import {
  createSessionToken,
  refreshSessionTokenIfNeeded,
  SESSION_REFRESH_THRESHOLD_SECONDS,
  verifySessionToken,
} from "../src/modules/auth/session";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });
config({ path: path.resolve(__dirname, "../../../.env.local") });

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.APP_TIMEZONE ??= "Etc/UTC";

const email = "epic7-smoke@local.test";
const emailNorm = email.toLowerCase();
const GOOD_PASS = "SmokePass-123";

function parseSetCookieSession(res: Response): string | null {
  const r = res as Response & { getSetCookie?: () => string[] };
  const list = typeof r.getSetCookie === "function" ? r.getSetCookie() : [];
  for (const c of list) {
    if (c.startsWith("stay_ops_session=")) {
      return c.split(";")[0]!.slice("stay_ops_session=".length);
    }
  }
  const single = res.headers.get("set-cookie");
  if (!single) return null;
  for (const part of single.split(",")) {
    const trimmed = part.trim();
    if (trimmed.startsWith("stay_ops_session=")) {
      return trimmed.split(";")[0]!.slice("stay_ops_session=".length);
    }
  }
  return null;
}

function decodePayload(token: string) {
  const [payloadB64] = token.split(".");
  if (!payloadB64) throw new Error("invalid token shape");
  const json = Buffer.from(payloadB64, "base64url").toString("utf8");
  return JSON.parse(json) as { iat: number; exp: number; aexp?: number; sub: string; role?: string };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.loginAttempt.deleteMany({ where: { email: emailNorm } });
    await prisma.user.deleteMany({ where: { email } });
    const passwordHash = await bcrypt.hash(GOOD_PASS, 10);
    const user = await prisma.user.create({
      data: { email, passwordHash, isActive: true, role: "operator" },
    });

    const { POST } = await import("../src/app/api/auth/login/route");

    const req = (password: string) =>
      new Request("http://local/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.77" },
        body: JSON.stringify({ email, password }),
      });

    for (let i = 0; i < 5; i += 1) {
      const r = await POST(req("wrong"));
      if (r.status !== 401) throw new Error(`Attempt ${i + 1}: expected 401, got ${r.status}`);
    }
    const locked = await POST(req("wrong"));
    if (locked.status !== 429) throw new Error(`Attempt 6: expected 429, got ${locked.status}`);
    const retryAfter = locked.headers.get("Retry-After");
    if (!retryAfter) throw new Error("429 missing Retry-After header");
    console.log("[smoke] lockout OK: 6th wrong password -> 429, Retry-After:", retryAfter);

    await prisma.loginAttempt.deleteMany({ where: { email: emailNorm } });
    const ok = await POST(req(GOOD_PASS));
    if (ok.status !== 200) throw new Error(`Good login: expected 200, got ${ok.status}`);
    const token = parseSetCookieSession(ok);
    if (!token) throw new Error("No stay_ops_session Set-Cookie on 200");
    const payload = decodePayload(token);
    if (typeof payload.iat !== "number" || typeof payload.exp !== "number" || typeof payload.aexp !== "number") {
      throw new Error(`Payload missing iat/exp/aexp: ${JSON.stringify(payload)}`);
    }
    if (payload.exp - payload.iat !== 3600) {
      throw new Error(`Expected exp-iat === 3600 (60m inactivity), got ${payload.exp - payload.iat}`);
    }
    console.log("[smoke] cookie payload OK:", { iat: payload.iat, exp: payload.exp, aexp: payload.aexp });

    const t0 = Date.UTC(2026, 4, 3, 12, 0, 0);
    const { token: tRefresh } = createSessionToken(user.id, "operator", t0);
    const vAtIssue = verifySessionToken(tRefresh, t0);
    if (!vAtIssue) throw new Error("verify at issue failed");
    const laterMs = t0 + (SESSION_REFRESH_THRESHOLD_SECONDS + 10) * 1000;
    const vLater = verifySessionToken(tRefresh, laterMs);
    if (!vLater) throw new Error("verify before refresh window failed");
    const refreshed = refreshSessionTokenIfNeeded(vLater, laterMs);
    if (!refreshed) throw new Error("expected refreshSessionTokenIfNeeded to re-issue after threshold");
    const vNew = verifySessionToken(refreshed.token, laterMs);
    if (!vNew) throw new Error("verify refreshed token failed");
    if (vNew.aexpUnixSeconds !== vLater.aexpUnixSeconds) {
      throw new Error("aexp must stay fixed across refresh");
    }
    if (vNew.iatUnixSeconds <= vLater.iatUnixSeconds) {
      throw new Error("iat should advance on refresh");
    }
    console.log("[smoke] middleware refresh logic OK (simulated time, no 6min wall wait): new iat", vNew.iatUnixSeconds);

    console.log("\nAll Epic 7 smoke checks passed.");
    console.log(
      "Optional HTTP smoke (needs `pnpm dev`): POST http://localhost:3000/api/auth/login six times with wrong password, then inspect Retry-After; after 6+ minutes of activity, any /api/* or /app/* request should return a new Set-Cookie (see docs/runbooks/auth-hardening.md).",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
