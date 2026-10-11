// @vitest-environment node
import { TRPCClientError } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { createTranslator } from "next-intl";
import { readClientError, translateError } from "@/api/errors";
import el from "../../../messages/el.json";
import en from "../../../messages/en.json";
import {
  adminProcedure,
  createTRPCRouter,
  domainErrorShape,
  operatorProcedure,
  publicProcedure,
  userProcedure,
} from "@/server/api/trpc";
import { DOMAIN_ERROR_CODES, DomainError } from "@stay-ops/domain";

const router = createTRPCRouter({
  open: publicProcedure.query(() => "ok"),
  mine: userProcedure.query(({ ctx }) => ctx.user.userId),
  write: operatorProcedure.mutation(() => "written"),
  admin: adminProcedure.query(() => "admin"),
  taken: publicProcedure.mutation(() => {
    throw new DomainError("ROOM_TAKEN", { guestName: "Maria" });
  }),
  validated: publicProcedure.input(z.object({ n: z.number() })).query(({ input }) => input.n),
});

const caller = (role: "viewer" | "operator" | "admin" | null) =>
  router.createCaller({
    headers: new Headers(),
    user: role ? { userId: "u1", role, sessionExpiresAt: new Date() } : null,
  });

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    return { http: (err as TRPCError).code, domain: domainErrorShape(err as TRPCError) };
  }
  throw new Error("expected a failure");
}

describe("tRPC procedures", () => {
  it("lets anyone call public procedures", async () => {
    await expect(caller(null).open()).resolves.toBe("ok");
  });

  it("requires a session for user procedures", async () => {
    expect(await codeOf(caller(null).mine())).toEqual({
      http: "UNAUTHORIZED",
      domain: { code: "UNAUTHORIZED", params: {} },
    });
    await expect(caller("viewer").mine()).resolves.toBe("u1");
  });

  it("checks roles on the server", async () => {
    expect((await codeOf(caller("viewer").write())).domain.code).toBe("FORBIDDEN");
    await expect(caller("operator").write()).resolves.toBe("written");
    expect((await codeOf(caller("operator").admin())).http).toBe("FORBIDDEN");
    await expect(caller("admin").admin()).resolves.toBe("admin");
  });

  it("turns a domain error into a conflict with its code and params", async () => {
    expect(await codeOf(caller(null).taken())).toEqual({
      http: "CONFLICT",
      domain: { code: "ROOM_TAKEN", params: { guestName: "Maria" } },
    });
  });

  it("reports bad input as VALIDATION", async () => {
    // @ts-expect-error deliberately wrong input
    expect(await codeOf(caller(null).validated({ n: "x" }))).toEqual({
      http: "BAD_REQUEST",
      domain: { code: "VALIDATION", params: {} },
    });
  });

  it("maps unexpected errors to INTERNAL", () => {
    expect(domainErrorShape(new TRPCError({ code: "INTERNAL_SERVER_ERROR" })).code).toBe("INTERNAL");
  });
});

describe("client error text", () => {
  it("has Greek and English text for every code", () => {
    for (const code of [...DOMAIN_ERROR_CODES, "NETWORK"] as const) {
      expect(el.errors[code]).toBeTruthy();
      expect(en.errors[code]).toBeTruthy();
    }
  });

  it("fills params and never shows the server message", () => {
    const err = new TRPCClientError("raw server text", {
      result: {
        error: {
          code: -32009,
          message: "raw server text",
          data: { domain: { code: "ROOM_TAKEN", params: { guestName: "Maria" } } },
        },
      },
    });
    const tEl = createTranslator({ locale: "el", messages: el, namespace: "errors" });
    const tEn = createTranslator({ locale: "en", messages: en, namespace: "errors" });
    expect(translateError(err, (code, params) => tEl(code, params))).toBe(
      "Το διαμέρισμα είναι πιασμένο αυτές τις μέρες (Maria).",
    );
    expect(translateError(err, (code, params) => tEn(code, params))).toBe(
      "The apartment is taken by Maria on these days.",
    );
  });

  it("treats a failed request as NETWORK and anything else as INTERNAL", () => {
    expect(readClientError(new TRPCClientError("fetch failed")).code).toBe("NETWORK");
    expect(readClientError(new Error("boom")).code).toBe("INTERNAL");
  });
});
