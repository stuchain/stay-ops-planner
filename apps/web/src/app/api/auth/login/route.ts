import { NextResponse } from "next/server";
import { attachTraceToResponse, apiError, respondAuthError } from "@/lib/apiError";
import { LoginBodySchema, loginWithEmailPassword } from "@/modules/auth/service";
import { AuthError } from "@/modules/auth/errors";
import { setSessionCookie } from "@/modules/auth/session";

export async function POST(request: Request) {
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

    return attachTraceToResponse(request, response);
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }
}

