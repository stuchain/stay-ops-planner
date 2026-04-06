import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";
import { rankBookingSuggestions } from "@/modules/suggestions/engine";
import type { SuggestionResponseItem } from "@/modules/suggestions/types";

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireAdminSession(request);
    const { id } = await ctx.params;
    const suggestions: SuggestionResponseItem[] = await rankBookingSuggestions(id);
    return NextResponse.json({
      data: suggestions,
      meta: { total: suggestions.length },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }
}
