export class CleaningBookingNotFoundError extends Error {
  readonly code = "BOOKING_NOT_FOUND" as const;
  readonly status = 404;

  constructor() {
    super("Booking not found");
    this.name = "CleaningBookingNotFoundError";
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
