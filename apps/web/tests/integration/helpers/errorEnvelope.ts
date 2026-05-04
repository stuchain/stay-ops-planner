import { expect } from "vitest";

/** Matches `ApiErrorEnvelope` from `@/modules/auth/errors` for integration assertions. */
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    traceId: string;
  };
};

export function assertApiErrorBody(
  json: unknown,
  expected: {
    code: string;
    traceId?: string;
    /** When true, `error.details` must be present (may be `null` only if API sends null). */
    expectDetailsDefined?: boolean;
  },
): asserts json is ApiErrorBody {
  expect(json).toEqual(
    expect.objectContaining({
      error: expect.objectContaining({
        code: expected.code,
        message: expect.any(String),
        traceId: expected.traceId ?? expect.any(String),
      }),
    }),
  );
  const body = json as ApiErrorBody;
  expect(body.error.traceId.length).toBeGreaterThanOrEqual(8);
  if (expected.traceId) {
    expect(body.error.traceId).toBe(expected.traceId);
  }
  if (expected.expectDetailsDefined) {
    expect(body.error).toHaveProperty("details");
    expect(body.error.details).not.toBeUndefined();
  }
}
