import type { NextRequest } from "next/server";
import { respondAuthError } from "@/lib/apiError";
import { NextResponse } from "next/server";
import { AuthError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { getOperationalDashboardSummary } from "@/modules/dashboard/queries";

export async function GET(request: NextRequest) {
  try {
    await requireOperatorOrAdmin(request);
    const summary = await getOperationalDashboardSummary();
    return NextResponse.json({ data: summary }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }
}
