import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { PrismaClient } from "@stay-ops/db";

const prisma = new PrismaClient();

export async function GET(_request: NextRequest) {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        status: "ok",
        checks: {
          db: "ok",
        },
        uptimeSeconds: process.uptime(),
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        checks: {
          db: "error",
        },
        uptimeSeconds: process.uptime(),
        durationMs: Date.now() - startedAt,
      },
      { status: 503 },
    );
  }
}
