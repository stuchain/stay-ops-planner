import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  withRetry,
  RetryExhaustedError,
  computeRetryDelayMs,
  defaultIsTransientError,
} from "./withRetry.js";

describe("computeRetryDelayMs", () => {
  it("increases with nextAttempt", () => {
    const a = computeRetryDelayMs(2, 100, 10_000);
    const b = computeRetryDelayMs(3, 100, 10_000);
    expect(b).toBeGreaterThanOrEqual(100);
    expect(a).toBeGreaterThanOrEqual(100);
  });
});

describe("defaultIsTransientError", () => {
  it("detects common network codes", () => {
    const e = new Error("x") as NodeJS.ErrnoException;
    e.code = "ECONNRESET";
    expect(defaultIsTransientError(e)).toBe(true);
  });

  it("returns false for generic errors", () => {
    expect(defaultIsTransientError(new Error("boom"))).toBe(false);
  });
});

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("succeeds on first attempt without onRetry", async () => {
    const op = vi.fn().mockResolvedValue(42);
    const p = withRetry(op, { maxAttempts: 3 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe(42);
    expect(op).toHaveBeenCalledTimes(1);
    expect(op).toHaveBeenCalledWith({ attempt: 1 });
  });

  it("retries transient until success", async () => {
    const err = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    const op = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce("ok");
    const onRetry = vi.fn();
    const p = withRetry(op, {
      maxAttempts: 5,
      baseDelayMs: 100,
      maxDelayMs: 5000,
      isTransient: defaultIsTransientError,
      onRetry,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    const arg = onRetry.mock.calls[0]![0];
    expect(arg.attempt).toBe(2);
    expect(arg.delayMs).toBeGreaterThanOrEqual(0);
    expect(arg.err).toBe(err);
  });

  it("does not retry non-transient", async () => {
    const op = vi.fn().mockRejectedValue(new Error("validation"));
    const p = withRetry(op, {
      maxAttempts: 5,
      isTransient: () => false,
    });
    await expect(p).rejects.toThrow("validation");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("caps at maxAttempts with RetryExhaustedError", async () => {
    const err = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    const op = vi.fn().mockRejectedValue(err);
    const p = withRetry(op, {
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 100,
      isTransient: defaultIsTransientError,
    });
    const run = async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    };
    void run();
    await expect(p).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("exhausts on timeout budget after backoff", async () => {
    const err = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    const op = vi.fn().mockRejectedValue(err);
    const p = withRetry(op, {
      maxAttempts: 10,
      baseDelayMs: 5000,
      maxDelayMs: 5000,
      timeoutBudgetMs: 2000,
      isTransient: defaultIsTransientError,
    });
    const run = async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    };
    void run();
    await expect(p).rejects.toBeInstanceOf(RetryExhaustedError);
  });
});
