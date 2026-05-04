import { describe, expect, it, beforeAll } from "vitest";
import type { NextRequest } from "next/server";
import { NextRequest as NextRequestClass } from "next/server";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

/**
 * Regression for Epic 11: post-deploy health probes (e.g. the GitHub Actions
 * `deployment_status` workflow) hit `/api/health/ready` (and friends) without
 * any session cookie. The middleware MUST allow these GETs through without
 * returning the standard JSON 401, otherwise external uptime monitors see
 * everything as broken even when the app is healthy.
 */
describe("health endpoints bypass auth in middleware", () => {
  let middlewareFn: (request: NextRequest) => Response;

  beforeAll(async () => {
    const middlewareModule = await import("../../../src/middleware");
    middlewareFn = middlewareModule.middleware;
  });

  const allowed: { name: string; url: string }[] = [
    { name: "alias /api/health", url: "http://localhost/api/health" },
    { name: "/api/health/live", url: "http://localhost/api/health/live" },
    { name: "/api/health/ready", url: "http://localhost/api/health/ready" },
  ];

  for (const { name, url } of allowed) {
    it(`GET ${name} passes through (no 401, x-middleware-next header set)`, () => {
      const req = new NextRequestClass(url, {
        method: "GET",
        headers: new Headers(),
      });
      const res = middlewareFn(req);

      expect(res.status, `expected non-401 from middleware for ${url}`).not.toBe(401);
      // NextResponse.next() always sets this internal header; if missing, the
      // middleware short-circuited with a real response (e.g. redirect/401).
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(res.headers.get("x-request-id")).toBeTruthy();
    });
  }

  it("non-GET methods on /api/health/ready are still gated by auth", () => {
    const req = new NextRequestClass("http://localhost/api/health/ready", {
      method: "POST",
      headers: new Headers(),
    });
    const res = middlewareFn(req);
    // The route handler itself only implements GET, but the middleware
    // allowlist must remain method-scoped so that a hypothetical mutating
    // request can't piggy-back on the public path.
    expect(res.status).toBe(401);
  });

  it("nested unknown health paths are NOT auto-allowed", () => {
    const req = new NextRequestClass("http://localhost/api/health/secret", {
      method: "GET",
      headers: new Headers(),
    });
    const res = middlewareFn(req);
    // Guards against accidental prefix-matching in the allowlist.
    expect(res.status).toBe(401);
  });
});
