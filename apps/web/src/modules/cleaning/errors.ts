export class CleaningBookingNotFoundError extends Error {
  readonly code = "BOOKING_NOT_FOUND" as const;
  readonly status = 404;
  readonly details?: { failedIndex?: number; bookingId?: string } | undefined;

  constructor(details?: { failedIndex?: number; bookingId?: string }) {
    super("Booking not found");
    this.name = "CleaningBookingNotFoundError";
    this.details = details;
  }
}

export class CleaningTaskNotFoundError extends Error {
  readonly code = "TASK_NOT_FOUND" as const;
  readonly status = 404;

  constructor(taskId: string) {
    void taskId;
    super("Cleaning task not found");
    this.name = "CleaningTaskNotFoundError";
  }
}

export class InvalidStateTransitionError extends Error {
  readonly code = "INVALID_STATE_TRANSITION" as const;
  readonly status = 422;

  constructor(message: string) {
    super(message);
    this.name = "InvalidStateTransitionError";
  }
}

export class StaleCleaningTaskError extends Error {
  readonly code = "STALE_TASK" as const;
  readonly status = 409;

  constructor() {
    super("Cleaning task was changed by someone else");
    this.name = "StaleCleaningTaskError";
  }
}

export function cleaningErrorEnvelope(
  err: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
  },
  traceId = "",
) {
  return {
    error: {
      code: err.code,
      message: err.message,
      details: err.details ?? undefined,
      traceId,
    },
  };
}
