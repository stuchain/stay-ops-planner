export class RetryExhaustedError extends Error {
  readonly cause: unknown;
  readonly attempts: number;
  readonly elapsedMs: number;

  constructor(message: string, opts: { cause: unknown; attempts: number; elapsedMs: number }) {
    super(message);
    this.name = "RetryExhaustedError";
    this.cause = opts.cause;
    this.attempts = opts.attempts;
    this.elapsedMs = opts.elapsedMs;
  }
}

export type RetryContext = {
  attempt: number;
};

export type OnRetryArgs = {
  /** 1-based index of the next attempt (after a failed attempt). */
  attempt: number;
  delayMs: number;
  err: unknown;
  traceId?: string;
};

export type OnExhaustedArgs = {
  attempts: number;
  elapsedMs: number;
  cause: unknown;
  traceId?: string;
};

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutBudgetMs?: number;
  isTransient?: (err: unknown) => boolean;
  onRetry?: (args: OnRetryArgs) => void;
  onExhausted?: (args: OnExhaustedArgs) => void;
  traceId?: string;
  signal?: AbortSignal;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Jitter in [0, 0.4 * delay) per Epic 3 plan. */
function jitterMs(delay: number): number {
  return Math.floor(Math.random() * (0.4 * delay));
}

/**
 * Delay before attempt `nextAttempt` (2 = before 2nd try, 3 = before 3rd try).
 * Uses base * 2^(nextAttempt - 2) capped by maxDelayMs.
 */
export function computeRetryDelayMs(
  nextAttempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exp = Math.max(0, nextAttempt - 2);
  const base = Math.min(maxDelayMs, baseDelayMs * 2 ** exp);
  return base + jitterMs(base);
}

export function defaultIsTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    const code = (err as NodeJS.ErrnoException).code;
    if (
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "ENOTFOUND" ||
      code === "ECONNREFUSED" ||
      code === "EPIPE" ||
      code === "EAI_AGAIN"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Retries an async operation on transient errors with exponential backoff + jitter
 * and an optional wall-clock budget.
 */
export async function withRetry<T>(
  op: (ctx: RetryContext) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  if (maxAttempts < 1) {
    throw new Error("withRetry: maxAttempts must be >= 1");
  }
  const baseDelayMs = opts.baseDelayMs ?? 200;
  const maxDelayMs = opts.maxDelayMs ?? 5000;
  const timeoutBudgetMs = opts.timeoutBudgetMs ?? 30_000;
  const isTransient = opts.isTransient ?? defaultIsTransientError;
  const started = Date.now();

  let lastErr: unknown;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;

    if (opts.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const elapsedBefore = Date.now() - started;
    if (elapsedBefore >= timeoutBudgetMs && attempt > 1) {
      opts.onExhausted?.({
        attempts: attempt - 1,
        elapsedMs: elapsedBefore,
        cause: lastErr,
        traceId: opts.traceId,
      });
      throw new RetryExhaustedError("Retry budget exhausted", {
        cause: lastErr,
        attempts: attempt - 1,
        elapsedMs: elapsedBefore,
      });
    }

    try {
      return await op({ attempt });
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) {
        throw err;
      }
      if (attempt >= maxAttempts) {
        const elapsedMs = Date.now() - started;
        opts.onExhausted?.({
          attempts: attempt,
          elapsedMs,
          cause: err,
          traceId: opts.traceId,
        });
        throw new RetryExhaustedError(`Operation failed after ${attempt} attempt(s)`, {
          cause: err,
          attempts: attempt,
          elapsedMs,
        });
      }

      const nextAttempt = attempt + 1;
      const delayMs = computeRetryDelayMs(nextAttempt, baseDelayMs, maxDelayMs);
      opts.onRetry?.({
        attempt: nextAttempt,
        delayMs,
        err,
        traceId: opts.traceId,
      });

      await sleep(delayMs);

      const elapsedAfterSleep = Date.now() - started;
      if (elapsedAfterSleep >= timeoutBudgetMs) {
        opts.onExhausted?.({
          attempts: attempt,
          elapsedMs: elapsedAfterSleep,
          cause: err,
          traceId: opts.traceId,
        });
        throw new RetryExhaustedError("Retry budget exhausted after backoff", {
          cause: err,
          attempts: attempt,
          elapsedMs: elapsedAfterSleep,
        });
      }
    }
  }

  throw new Error("withRetry: unreachable");
}
