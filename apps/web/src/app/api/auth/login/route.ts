import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { writeAuditSnapshot } from "@stay-ops/audit";
import { attachTraceToResponse, apiError, respondAuthError } from "@/lib/apiError";
import { getClientIp } from "@/lib/clientIp";
import { prisma } from "@/lib/prisma";
import { withRateLimit, LOGIN_IP_RATE_RULES } from "@/lib/rateLimit";
import { LoginBodySchema, loginWithEmailPassword } from "@/modules/auth/service";
import { AuthError } from "@/modules/auth/errors";
import { assertLoginAllowed } from "@/modules/auth/loginThrottle";
import { setSessionCookie } from "@/modules/auth/session";

function emailNormFromBody(email: string) {
  return email.trim().toLowerCase();
}

function emailHash(emailNorm: string) {
  return createHash("sha256").update(emailNorm, "utf8").digest("hex");
}

async function postLogin(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(request, "VALIDATION_ERROR", "Invalid request body", 400);
  }

  const parsed = LoginBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(request, "VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
  }

  const emailNorm = emailNormFromBody(parsed.data.email);
  const ip = getClientIp(request);

  try {
    await assertLoginAllowed(emailNorm, ip);
  } catch (err) {
    if (err instanceof AuthError && err.code === "RATE_LIMITED") {
      try {
        await prisma.$transaction(async (tx) => {
          await writeAuditSnapshot(tx, {
            entityType: "auth",
            entityId: emailHash(emailNorm),
            action: "auth.login.locked_out",
            before: {},
            after: { blocked: true },
            meta: { ip, emailHash: emailHash(emailNorm) },
          });
        });
      } catch {
        // audit must not block lockout response
      }
      return respondAuthError(request, err);
    }
    throw err;
  }

  try {
    const result = await loginWithEmailPassword(parsed.data);

    await prisma.$transaction(async (tx) => {
      await tx.loginAttempt.create({
        data: { email: emailNorm, ip, succeeded: true },
      });
      await writeAuditSnapshot(tx, {
        actorUserId: result.user.id,
        entityType: "auth",
        entityId: result.user.id,
        action: "auth.login.succeeded",
        before: {},
        after: { ok: true },
        meta: { ip, emailHash: emailHash(emailNorm) },
      });
    });

    const response = NextResponse.json(
      {
        data: {
          user: result.user,
          sessionExpiresAt: result.sessionExpiresAt,
        },
      },
      { status: 200 },
    );

    setSessionCookie(response, result.token, new Date(result.sessionExpiresAt));

    return attachTraceToResponse(request, response);
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === "INVALID_CREDENTIALS") {
        try {
          await prisma.$transaction(async (tx) => {
            await tx.loginAttempt.create({
              data: { email: emailNorm, ip, succeeded: false },
            });
            await writeAuditSnapshot(tx, {
              entityType: "auth",
              entityId: emailHash(emailNorm),
              action: "auth.login.failed",
              before: {},
              after: { ok: false },
              meta: { ip, emailHash: emailHash(emailNorm) },
            });
          });
        } catch {
          // still return 401
        }
        return respondAuthError(request, err);
      }
      return respondAuthError(request, err);
    }
    throw err;
  }
}

export async function POST(request: Request) {
  return withRateLimit("POST:/api/auth/login", LOGIN_IP_RATE_RULES, request, postLogin);
}
