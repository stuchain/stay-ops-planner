import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../../../src/modules/health/checks");
});

describe("api health", () => {
  it("/api/health returns readiness 200 when db is reachable", async () => {
    vi.doMock("../../../src/modules/health/checks", () => ({
      checkDatabaseConnectivity: vi.fn().mockResolvedValue(true),
    }));
    const GET_HEALTH = (await import("../../../src/app/api/health/route")).GET;
    const res = await GET_HEALTH();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; kind?: string; checks: { db: string } };
    expect(json.status).toBe("ok");
    expect(json.checks.db).toBe("ok");
    expect(json.kind).toBe("readiness");
  });

  it("/api/health/ready matches readiness", async () => {
    vi.doMock("../../../src/modules/health/checks", () => ({
      checkDatabaseConnectivity: vi.fn().mockResolvedValue(true),
    }));
    const GET_READY = (await import("../../../src/app/api/health/ready/route")).GET;
    const res = await GET_READY();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { kind: string; checks: { db: string } };
    expect(json.kind).toBe("readiness");
    expect(json.checks.db).toBe("ok");
  });

  it("/api/health/live returns liveness without db check", async () => {
    const GET_LIVE = (await import("../../../src/app/api/health/live/route")).GET;
    const res = await GET_LIVE();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { kind: string; status: string };
    expect(json.kind).toBe("liveness");
    expect(json.status).toBe("ok");
  });

  it("/api/health/ready returns 503 when db is unreachable", async () => {
    vi.doMock("../../../src/modules/health/checks", () => ({
      checkDatabaseConnectivity: vi.fn().mockResolvedValue(false),
    }));
    const GET_READY = (await import("../../../src/app/api/health/ready/route")).GET;
    const res = await GET_READY();
    expect(res.status).toBe(503);
    const json = (await res.json()) as { status: string; kind: string; checks: { db: string } };
    expect(json.status).toBe("degraded");
    expect(json.kind).toBe("readiness");
    expect(json.checks.db).toBe("error");
  });
});
