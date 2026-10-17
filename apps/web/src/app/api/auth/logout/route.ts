import { NextResponse } from "next/server";
import { attachTraceToResponse } from "@/lib/apiError";
import { newTraceId, readTraceId, TRACE_HEADER } from "@/lib/traceId";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { assertLogoutTokenPresent } from "@/modules/auth/service";
import { prisma } from "@/lib/prisma";
import { clearSessionCookie, readCookieValue, SESSION_COOKIE_NAME, verifySessionToken } from "@/modules/auth/session";

export async function POST(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  const token = readCookieValue(cookieHeader, SESSION_COOKIE_NAME);
  const traceId = readTraceId(request) || newTraceId();

  try {
    assertLogoutTokenPresent(token);
  } catch (err) {
    if (err instanceof AuthError) {
      return attachTraceToResponse(
        request,
        NextResponse.json(jsonError(err.code, err.message, err.details, traceId), {
          status: err.status,
        }),
      );
    }
    throw err;
  }

  // Signing out ends this user's sessions on every device, so a copied cookie stops working too.
  const session = token ? verifySessionToken(token) : null;
  if (session) {
    await prisma.user.updateMany({
      where: { id: session.userId, sessionVersion: session.sessionVersion },
      data: { sessionVersion: { increment: 1 } },
    });
  }

  const response = new NextResponse(null, { status: 204 });
  clearSessionCookie(response);
  response.headers.set(TRACE_HEADER, traceId);
  return attachTraceToResponse(request, response);
}
