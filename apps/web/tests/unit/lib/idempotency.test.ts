import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { withIdempotency } from "@/lib/idempotency";

describe("withIdempotency", () => {
  it("invokes handler once when Idempotency-Key header is absent", async () => {
    let calls = 0;
    const req = new NextRequest("http://localhost/api/demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    const res = await withIdempotency("POST:/api/demo", req, async () => {
      calls += 1;
      return NextResponse.json({ ok: true }, { status: 200 });
    });
    expect(calls).toBe(1);
    expect(res.status).toBe(200);
  });

  it("returns 400 for invalid idempotency key characters", async () => {
    const req = new NextRequest("http://localhost/api/demo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "bad key",
      },
      body: JSON.stringify({ a: 1 }),
    });
    const res = await withIdempotency("POST:/api/demo", req, async () => NextResponse.json({ ok: true }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });
});
