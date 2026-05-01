import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { respondAuthError } from "@/lib/apiError";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";
import { deleteHosthubToken, getHosthubTokenStatus, setHosthubToken } from "@/modules/integrations/hosthubToken";

const PutSchema = z.object({
  token: z.string().min(1),
  name: z.string().trim().max(120).optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAdminSession(request);
    const data = await getHosthubTokenStatus();
    return NextResponse.json({ data }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid request body"), { status: 400 });
  }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(jsonError("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()), {
      status: 400,
    });
  }

  try {
    const data = await setHosthubToken(parsed.data);
    return NextResponse.json({ data }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save token";
    return NextResponse.json(jsonError("VALIDATION_ERROR", message), { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdminSession(request);
    const data = await deleteHosthubToken();
    return NextResponse.json({ data }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }
}
