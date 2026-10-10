import { describe, expect, it } from "vitest";
import { Prisma } from "@stay-ops/db";
import { isTransientPrismaError } from "./isTransient.js";

describe("isTransientPrismaError", () => {
  it("matches known transient codes", () => {
    const e = new Prisma.PrismaClientKnownRequestError("x", { code: "P2034", clientVersion: "1" });
    expect(isTransientPrismaError(e)).toBe(true);
  });

  it("rejects non-transient codes", () => {
    const e = new Prisma.PrismaClientKnownRequestError("x", { code: "P2002", clientVersion: "1" });
    expect(isTransientPrismaError(e)).toBe(false);
  });

  it("matches serialization hints in unknown request errors", () => {
    const e = new Prisma.PrismaClientUnknownRequestError("could not serialize", { clientVersion: "1" });
    expect(isTransientPrismaError(e)).toBe(true);
  });
});
