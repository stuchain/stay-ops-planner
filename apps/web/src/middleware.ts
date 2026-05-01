import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jsonError } from "@/modules/auth/errors";
import { clearSessionCookie } from "@/modules/auth/session";
import { getSessionContextFromRequest } from "@/modules/auth/guard";
import { newTraceId, TRACE_HEADER } from "@/lib/traceId";

function nextWithTrace(request: NextRequest, traceId: string): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(TRACE_HEADER, traceId);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(TRACE_HEADER, traceId);
  return res;
}

export function middleware(request: NextRequest) {
  const traceId = newTraceId();

  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();

  const isApi = pathname.startsWith("/api/");
  const isApp = pathname.startsWith("/app/");

  // Public allowlist (Phase 1)
  const isHealth = isApi && pathname === "/api/health" && method === "GET";
  const isLogin = isApi && pathname === "/api/auth/login" && method === "POST";
  const isHosthubWebhook =
    isApi && pathname === "/api/sync/hosthub/webhook" && method === "POST";

  if (!isApi && !isApp) {
    const res = NextResponse.next();
    res.headers.set(TRACE_HEADER, traceId);
    return res;
  }
  if (isHealth || isLogin || isHosthubWebhook) {
    return nextWithTrace(request, traceId);
  }

  const { context, tokenPresent } = getSessionContextFromRequest(request);
  if (context) {
    return nextWithTrace(request, traceId);
  }

  // API paths respond with JSON 401.
  if (isApi) {
    const response = NextResponse.json(
      jsonError("UNAUTHORIZED", "Authentication required", undefined, traceId),
      { status: 401 },
    );
    response.headers.set(TRACE_HEADER, traceId);
    if (tokenPresent) clearSessionCookie(response);
    return response;
  }

  // Browser/app paths redirect to login.
  const nextPath = request.nextUrl.pathname + request.nextUrl.search;
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", nextPath);

  const response = NextResponse.redirect(loginUrl);
  response.headers.set(TRACE_HEADER, traceId);
  if (tokenPresent) clearSessionCookie(response);
  return response;
}

export const config = {
  // Only `/app` and `/api` need auth; everything else skips middleware entirely.
  matcher: ["/app/:path*", "/api/:path*"],
  runtime: "nodejs",
};
