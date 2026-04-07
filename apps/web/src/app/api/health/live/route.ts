import { NextResponse } from "next/server";

/** Liveness: process is up (no dependency checks). */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      kind: "liveness",
      uptimeSeconds: process.uptime(),
    },
    { status: 200 },
  );
}
