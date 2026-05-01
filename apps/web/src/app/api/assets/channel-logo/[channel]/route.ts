import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { respondAuthError } from "@/lib/apiError";
import { AuthError } from "@/modules/auth/errors";
import { requireSession } from "@/modules/auth/guard";

function logoFilenameForChannel(channel: string): string | null {
  if (channel === "airbnb") return "airbnb logo.png";
  if (channel === "booking") return "booking logo.png";
  if (channel === "hosthub" || channel === "direct") return "hosthub logo.png";
  return null;
}

async function resolveContentPath(filename: string): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), "content", filename),
    path.resolve(process.cwd(), "..", "..", "content", filename),
    path.resolve(process.cwd(), "..", "..", "..", "content", filename),
  ];
  for (const p of candidates) {
    try {
      await access(p);
      return p;
    } catch {
      // Keep checking candidate paths until one exists.
    }
  }
  return null;
}

export async function GET(request: NextRequest, context: { params: Promise<{ channel: string }> }) {
  try {
    await requireSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }

  const params = await context.params;
  const channel = params.channel?.toLowerCase() ?? "";
  const filename = logoFilenameForChannel(channel);
  if (!filename) {
    return new NextResponse("Not found", { status: 404 });
  }
  const fullPath = await resolveContentPath(filename);
  if (!fullPath) {
    return new NextResponse("Not found", { status: 404 });
  }
  const buffer = await readFile(fullPath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
