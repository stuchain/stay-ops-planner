/**
 * Every error the new UI can show has a code. The client translates the code
 * (`apps/web/messages/*.json`, under `errors`) and never shows `error.message`.
 */
export const DOMAIN_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "BOOKING_CHANGED",
  "ROOM_TAKEN",
  "ROOM_CLOSED",
  "ROOM_INACTIVE",
  "NOT_CONFIRMED",
  "STAY_STARTED",
  "STAY_ENDED",
  "INVALID_STAY",
  "HOSTHUB_DISCONNECTED",
  "ROOM_HAS_BOOKINGS",
  "CHANGED_MEANWHILE",
  "WRONG_PASSWORD",
  "PASSWORD_TOO_SHORT",
  "SYNC_RUNNING",
  "HOSTHUB_TOKEN_REJECTED",
  "HOSTHUB_UNREACHABLE",
  "INTERNAL",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/** Safe, user-facing values the message may use, for example the guest who is in the room. */
export type DomainErrorParams = Readonly<Record<string, string | number>>;

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly params: DomainErrorParams;

  constructor(code: DomainErrorCode, params: DomainErrorParams = {}, message?: string) {
    super(message ?? code);
    this.name = "DomainError";
    this.code = code;
    this.params = params;
  }
}

export function isDomainErrorCode(value: unknown): value is DomainErrorCode {
  return typeof value === "string" && (DOMAIN_ERROR_CODES as readonly string[]).includes(value);
}
