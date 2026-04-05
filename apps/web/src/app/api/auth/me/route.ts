import { NextResponse } from "next/server";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { getMeFromSessionToken } from "@/modules/auth/service";
import { readCookieValue, SESSION_COOKIE_NAME } from "@/modules/auth/session";

export async function GET(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  const token = readCookieValue(cookieHeader, SESSION_COOKIE_NAME);

  if (!token) {
    const response = NextResponse.json(
      jsonError("UNAUTHORIZED", "Authentication required"),
      { status: 401 },
    );
    return response;
  }

  try {
    const me = await getMeFromSessionToken(token);
    return NextResponse.json(
      {
        data: {
          user: me.user,
          sessionExpiresAt: me.sessionExpiresAt,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), {
        status: err.status,
      });
    }
    throw err;
  }
}

