import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";
import { getOperationalDashboardSummary } from "@/modules/dashboard/queries";

export async function GET(request: NextRequest) {
  try {
    requireAdminSession(request);
    const summary = await getOperationalDashboardSummary();
    return NextResponse.json({ data: summary }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }
}
