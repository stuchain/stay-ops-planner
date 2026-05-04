/**
 * API error envelope + x-request-id correlation (Epic 1).
 */
import "./setup";

import { describe, expect, it, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@stay-ops/db";
import { CookieJar } from "./cookieJar";
import { assertApiErrorBody } from "./helpers/errorEnvelope";

const email = "error-contract-admin@example.com";
const password = "password1234";

process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.APP_TIMEZONE ??= "Etc/UTC";

describe("error contract (traceId + x-request-id)", () => {
  const prisma = new PrismaClient();
  let middlewareFn: (request: NextRequest) => Response;
  let GET_CALENDAR_MONTH: (request: NextRequest) => Promise<Response>;
  let GET_BOOKINGS_LIST: (request: NextRequest) => Promise<Response>;
  let POST_LOGIN: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    await prisma.$connect();
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, isActive: true },
      create: { email, passwordHash, isActive: true },
    });

    const mw = await import("../../src/middleware");
    middlewareFn = mw.middleware;

    GET_CALENDAR_MONTH = (await import("../../src/app/api/calendar/month/route")).GET;
    GET_BOOKINGS_LIST = (await import("../../src/app/api/bookings/list/route")).GET;
    POST_LOGIN = (await import("../../src/app/api/auth/login/route")).POST;
  });

  it("middleware 401 includes traceId in body matching x-request-id header", async () => {
    const req = new NextRequest("http://localhost/api/auth/me", {
      method: "GET",
      headers: new Headers(),
    });
    const res = middlewareFn(req);
    expect(res.status).toBe(401);
    const rid = res.headers.get("x-request-id");
    expect(rid).toBeTruthy();
    expect(rid!.length).toBeGreaterThanOrEqual(32);
    const json = await res.json();
    assertApiErrorBody(json, { code: "UNAUTHORIZED", traceId: rid! });
  });

  it("GET /api/bookings/list echoes x-request-id on success when provided on request", async () => {
    const jar = new CookieJar();
    const loginRes = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(loginRes.status).toBe(200);
    jar.applySetCookieHeader(loginRes);

    const tid = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
    const req = new NextRequest("http://localhost/api/bookings/list", {
      method: "GET",
      headers: new Headers({
        cookie: jar.getCookieHeader(),
        "x-request-id": tid,
      }),
    });
    const res = await GET_BOOKINGS_LIST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe(tid);
  });

  it("GET /api/calendar/month validation error includes traceId matching header", async () => {
    const jar = new CookieJar();
    const loginRes = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar.getCookieHeader(),
        },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(loginRes.status).toBe(200);
    jar.applySetCookieHeader(loginRes);

    const tid = "bbbbbbbb-bbbb-4ccc-dddd-eeeeeeeeeeee";
    const req = new NextRequest("http://localhost/api/calendar/month?month=not-a-month", {
      method: "GET",
      headers: new Headers({
        cookie: jar.getCookieHeader(),
        "x-request-id": tid,
      }),
    });
    const res = await GET_CALENDAR_MONTH(req);
    expect(res.status).toBe(400);
    expect(res.headers.get("x-request-id")).toBe(tid);
    const json = await res.json();
    assertApiErrorBody(json, {
      code: "VALIDATION_ERROR",
      traceId: tid,
      expectDetailsDefined: true,
    });
  });

  it("POST /api/auth/login invalid body returns VALIDATION_ERROR with details + traceId", async () => {
    const tid = "cccccccc-bbbb-4ccc-dddd-eeeeeeeeeeee";
    const res = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": tid,
        },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("x-request-id")).toBe(tid);
    const json = await res.json();
    assertApiErrorBody(json, { code: "VALIDATION_ERROR", traceId: tid, expectDetailsDefined: true });
  });

  it("POST /api/auth/login invalid credentials returns INVALID_CREDENTIALS + traceId", async () => {
    const tid = "dddddddd-bbbb-4ccc-dddd-eeeeeeeeeeee";
    const res = await POST_LOGIN(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": tid,
        },
        body: JSON.stringify({ email, password: "not-the-password" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toBe(tid);
    const json = await res.json();
    assertApiErrorBody(json, { code: "INVALID_CREDENTIALS", traceId: tid });
  });
});
