export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type AuthErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "UNAUTHORIZED"
  | "ACCOUNT_DISABLED";

export class AuthError extends Error {
  public readonly code: AuthErrorCode;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(args: {
    code: AuthErrorCode;
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

export function jsonError(code: string, message: string, details?: unknown): ApiErrorEnvelope {
  return {
    error: {
      code,
      message,
      details: details ?? undefined,
    },
  };
}

