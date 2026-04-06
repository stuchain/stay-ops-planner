import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

describe("api /api/health", () => {
  it("returns 200 with ok status when db is reachable", async () => {
    const GET_HEALTH = (await import("../../../src/app/api/health/route.ts")).GET;
    const res = await GET_HEALTH(new NextRequest("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; checks: { db: string } };
    expect(json.status).toBe("ok");
    expect(json.checks.db).toBe("ok");
  });
});
