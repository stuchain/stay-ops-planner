import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/modules/auth/guard";

vi.mock("@/modules/auth/guard", () => ({
  verifyAndLoadAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(undefined),
  },
}));

import { prisma } from "@/lib/prisma";
import { verifyAndLoadAuthContext } from "@/modules/auth/guard";
import { withRateLimit } from "@/lib/rateLimit";

describe("withRateLimit", () => {
  beforeEach(() => {
    vi.mocked(verifyAndLoadAuthContext).mockResolvedValue({
      userId: "u1",
      role: "operator",
      sessionExpiresAt: new Date(),
    } satisfies AuthContext);
    vi.mocked(prisma.$queryRaw).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("allows requests under the limit", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ count: 1 }]);
    const handler = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const req = new NextRequest("http://localhost/api/x", { method: "POST" });
    const res = await withRateLimit("POST:/x", [{ key: "user", limit: 5, windowMs: 60_000 }], req, handler);
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("returns 429 when count exceeds limit", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ count: 6 }]);
    const handler = vi.fn();
    const req = new NextRequest("http://localhost/api/x", { method: "POST" });
    const res = await withRateLimit("POST:/x", [{ key: "user", limit: 5, windowMs: 60_000 }], req, handler);
    expect(res.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("degrades open when DB throws", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("db down"));
    const handler = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const req = new NextRequest("http://localhost/api/x", { method: "POST" });
    const res = await withRateLimit("POST:/x", [{ key: "user", limit: 1, windowMs: 60_000 }], req, handler);
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it("returns 401 when user rule present and unauthenticated", async () => {
    vi.mocked(verifyAndLoadAuthContext).mockResolvedValueOnce(null);
    const handler = vi.fn();
    const req = new NextRequest("http://localhost/api/x", { method: "POST" });
    const res = await withRateLimit("POST:/x", [{ key: "user", limit: 1, windowMs: 60_000 }], req, handler);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});
