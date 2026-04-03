import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jsonError } from "./modules/auth/errors";
import { clearSessionCookie } from "./modules/auth/session";
import { getSessionContextFromRequest } from "./modules/auth/guard";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();

  const isApi = pathname.startsWith("/api/");
  const isApp = pathname.startsWith("/app/");

  // Public allowlist (Phase 1)
  const isHealth = isApi && pathname === "/api/health" && method === "GET";
  const isLogin = isApi && pathname === "/api/auth/login" && method === "POST";

  if (!isApi && !isApp) return NextResponse.next();
  if (isHealth || isLogin) return NextResponse.next();

  const { context, tokenPresent } = getSessionContextFromRequest(request);
  if (context) return NextResponse.next();

  // API paths respond with JSON 401.
  if (isApi) {
    const response = NextResponse.json(jsonError("UNAUTHORIZED", "Authentication required"), {
      status: 401,
    });
    if (tokenPresent) clearSessionCookie(response);
    return response;
  }

  // Browser/app paths redirect to login.
  const nextPath = request.nextUrl.pathname + request.nextUrl.search;
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", nextPath);

  const response = NextResponse.redirect(loginUrl);
  if (tokenPresent) clearSessionCookie(response);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
  runtime: "nodejs",
};

