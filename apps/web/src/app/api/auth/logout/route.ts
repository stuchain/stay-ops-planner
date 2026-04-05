import { NextResponse } from "next/server";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { assertLogoutTokenPresent } from "@/modules/auth/service";
import { clearSessionCookie, readCookieValue, SESSION_COOKIE_NAME } from "@/modules/auth/session";

export async function POST(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  const token = readCookieValue(cookieHeader, SESSION_COOKIE_NAME);

  try {
    assertLogoutTokenPresent(token);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), {
        status: err.status,
      });
    }
    throw err;
  }

  const response = new NextResponse(null, { status: 204 });
  clearSessionCookie(response);
  return response;
}

