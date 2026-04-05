export type AllocationErrorCode =
  | "STALE_VERSION"
  | "BOOKING_NOT_ASSIGNABLE"
  | "BOOKING_ALREADY_ASSIGNED"
  | "ASSIGNMENT_NOT_FOUND"
  | "CONFLICT_ASSIGNMENT"
  | "CONFLICT_BLOCK";

export class AllocationError extends Error {
  public readonly code: AllocationErrorCode;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(args: {
    code: AllocationErrorCode;
    message: string;
    status: number;
    details?: unknown;
  }) {
    super(args.message);
    this.code = args.code;
    this.status = args.status;
    this.details = args.details;
  }
}

export function allocationErrorEnvelope(err: AllocationError) {
  return {
    error: {
      code: err.code,
      message: err.message,
      details: err.details ?? undefined,
    },
  };
}
