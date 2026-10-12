import { TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest";
import { needsFallbackMessage } from "@/api/mutationErrors";

const failure = new Error("boom");

describe("needsFallbackMessage", () => {
  it("speaks up for a save with no error handling of its own", () => {
    expect(needsFallbackMessage({ options: {}, meta: undefined }, failure)).toBe(true);
  });

  it("stays quiet when the save has its own onError", () => {
    expect(needsFallbackMessage({ options: { onError: () => undefined }, meta: undefined }, failure)).toBe(false);
  });

  it("stays quiet when the save is marked as showing its own error", () => {
    expect(needsFallbackMessage({ options: {}, meta: { handlesErrors: true } }, failure)).toBe(false);
  });

  it("leaves an expired session to the sign-in dialog", () => {
    const expired = new TRPCClientError("UNAUTHORIZED", {
      result: { error: { message: "x", code: -32001, data: { domain: { code: "UNAUTHORIZED" } } } },
    });
    expect(needsFallbackMessage({ options: {}, meta: undefined }, expired)).toBe(false);
  });
});
