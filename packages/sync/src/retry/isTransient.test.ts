import { describe, expect, it } from "vitest";
import { Prisma } from "@stay-ops/db";
import {
  isTransientPrismaError,
  isTransientHosthubError,
  isTransientSyncError,
  pickPrismaErrorCode,
} from "./isTransient.js";
import { hosthubError } from "../hosthub/errors.js";

describe("isTransientPrismaError", () => {
  it("matches known transient codes", () => {
    const e = new Prisma.PrismaClientKnownRequestError("x", { code: "P2034", clientVersion: "1" });
    expect(isTransientPrismaError(e)).toBe(true);
    expect(pickPrismaErrorCode(e)).toBe("P2034");
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

describe("isTransientHosthubError", () => {
  it("delegates to retryable hosthub errors", () => {
    expect(isTransientHosthubError(hosthubNetworkError())).toBe(true);
    expect(isTransientHosthubError(hosthubAuthError())).toBe(false);
  });
});

function hosthubNetworkError() {
  return hosthubError("HOSTHUB_NETWORK_ERROR", "net");
}

function hosthubAuthError() {
  return hosthubError("HOSTHUB_AUTH_FAILED", "auth");
}

describe("isTransientSyncError", () => {
  it("combines prisma and network", () => {
    const net = Object.assign(new Error("x"), { code: "ECONNRESET" });
    expect(isTransientSyncError(net)).toBe(true);
    const e = new Prisma.PrismaClientKnownRequestError("x", { code: "P1017", clientVersion: "1" });
    expect(isTransientSyncError(e)).toBe(true);
  });
});
