/** Greek, plain-language messages for allocation failures (never show raw server text). */
const GENERIC_MESSAGE = "Κάτι πήγε στραβά. Δοκιμάστε ξανά.";
const STALE_MESSAGE = "Η κράτηση άλλαξε μόλις τώρα. Η οθόνη ενημερώθηκε, δοκιμάστε ξανά.";

const MESSAGES: Record<string, string> = {
  CONFLICT_ASSIGNMENT: "Το διαμέρισμα είναι ήδη κλεισμένο εκείνες τις μέρες.",
  CONFLICT_BLOCK: "Το διαμέρισμα είναι κλειστό εκείνες τις μέρες.",
  STALE_VERSION: STALE_MESSAGE,
  BOOKING_NOT_ASSIGNABLE: "Αυτή η κράτηση δεν έχει επιβεβαιωθεί ακόμη.",
  ROOM_INACTIVE: "Αυτό το διαμέρισμα είναι απενεργοποιημένο.",
};

/** Server codes that all mean "someone changed this booking since the screen loaded". */
const STALE_CODES = new Set(["STALE_VERSION", "VERSION_CONFLICT", "BOOKING_ALREADY_ASSIGNED"]);

// The raw server message is accepted for compatibility but intentionally never shown.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function formatAllocationError(code: string | undefined, _message?: string): string {
  if (code && STALE_CODES.has(code)) return STALE_MESSAGE;
  if (code && Object.prototype.hasOwnProperty.call(MESSAGES, code)) return MESSAGES[code]!;
  return GENERIC_MESSAGE;
}

export class AllocationMutationError extends Error {
  readonly code?: string | undefined;
  readonly details?: unknown;

  constructor(code?: string, details?: unknown) {
    super(formatAllocationError(code));
    this.name = "AllocationMutationError";
    this.code = code;
    this.details = details;
  }
}

export function isStaleVersionError(e: unknown): boolean {
  return e instanceof AllocationMutationError && e.code !== undefined && STALE_CODES.has(e.code);
}
