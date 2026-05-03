import { NextResponse } from "next/server";
import { attachTraceToResponse, apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { newTraceId, readTraceId, TRACE_HEADER } from "@/lib/traceId";
import { jsonError } from "@/modules/auth/errors";
import { LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_MS } from "@/modules/auth/loginThrottle";

type UserDiagRow = {
  id: string;
  email: string;
  is_active: boolean;
  role: string;
};

function emailNormFromQuery(raw: string | null): string | null {
  const t = raw?.trim().toLowerCase() ?? "";
  if (!t || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return null;
  return t;
}

export async function GET(request: Request) {
  const traceId = readTraceId(request) || newTraceId();

  if (process.env.NODE_ENV === "production") {
    const res = NextResponse.json(jsonError("NOT_FOUND", "Not found", undefined, traceId), { status: 404 });
    res.headers.set(TRACE_HEADER, traceId);
    return res;
  }

  const url = new URL(request.url);
  const emailNorm = emailNormFromQuery(url.searchParams.get("email"));
  if (!emailNorm) {
    return apiError(
      request,
      "VALIDATION_ERROR",
      "Query parameter `email` must be a valid address",
      400,
      undefined,
      { route: "/api/auth/_diag", method: "GET" },
    );
  }

  const since = new Date(Date.now() - LOGIN_WINDOW_MS);

  let userRows: UserDiagRow[];
  try {
    userRows = await prisma.$queryRaw<UserDiagRow[]>`
      SELECT id, email, is_active, role::text as role
      FROM users
      WHERE LOWER(TRIM(email)) = ${emailNorm}
      LIMIT 1
    `;
  } catch (err) {
    return apiError(
      request,
      "INTERNAL_ERROR",
      "Internal server error",
      500,
      undefined,
      { route: "/api/auth/_diag", method: "GET" },
      err,
    );
  }

  const user = userRows[0];

  const recentFailedAttempts = await prisma.loginAttempt.count({
    where: { email: emailNorm, succeeded: false, createdAt: { gte: since } },
  });

  const lockedOut = recentFailedAttempts >= LOGIN_EMAIL_LIMIT;

  return attachTraceToResponse(
    request,
    NextResponse.json(
      {
        data: {
          exists: Boolean(user),
          isActive: user ? user.is_active : null,
          role: user ? user.role : null,
          recentFailedAttempts,
          lockedOut,
        },
      },
      { status: 200 },
    ),
  );
}
