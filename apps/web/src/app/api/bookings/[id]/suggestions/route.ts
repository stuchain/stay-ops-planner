import type { NextRequest } from "next/server";
import { respondAuthError } from "@/lib/apiError";
import { NextResponse } from "next/server";
import { AuthError } from "@/modules/auth/errors";
import { requireOperatorOrAdmin } from "@/modules/auth/guard";
import { rankBookingSuggestions } from "@/modules/suggestions/engine";
import type { SuggestionResponseItem } from "@/modules/suggestions/types";

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireOperatorOrAdmin(request);
    const { id } = await ctx.params;
    const suggestions: SuggestionResponseItem[] = await rankBookingSuggestions(id);
    return NextResponse.json({
      data: suggestions,
      meta: { total: suggestions.length },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }
}
