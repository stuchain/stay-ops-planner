import { NextResponse } from "next/server";
import { LoginBodySchema, loginWithEmailPassword } from "@/modules/auth/service";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { setSessionCookie } from "@/modules/auth/session";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      jsonError("VALIDATION_ERROR", "Invalid request body"),
      { status: 400 },
    );
  }

  const parsed = LoginBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      jsonError("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()),
      { status: 400 },
    );
  }

  try {
    const result = await loginWithEmailPassword(parsed.data);
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

    return response;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), {
        status: err.status,
      });
    }
    throw err;
  }
}

