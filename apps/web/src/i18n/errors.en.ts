import type { DomainErrorCode } from "@/server/errors";

/** English text for every error code. `{name}` is filled from the error's params. */
export const errorsEn: Record<DomainErrorCode | "NETWORK", string> = {
  UNAUTHORIZED: "Your session has ended. Please sign in again.",
  FORBIDDEN: "You are not allowed to do this.",
  NOT_FOUND: "Not found. It may have been deleted.",
  VALIDATION: "Something is not filled in correctly. Please check the details.",
  BOOKING_CHANGED: "This booking changed in the meantime. Look at it again and retry.",
  ROOM_TAKEN: "The apartment is taken by {guestName} on these days.",
  ROOM_CLOSED: "The apartment is closed on these days.",
  ROOM_INACTIVE: "This apartment is not in use.",
  NOT_CONFIRMED: "This booking is not confirmed yet.",
  STAY_STARTED: "The guest has already arrived. Move them anyway?",
  INVALID_STAY: "Departure must be after arrival.",
  HOSTHUB_DISCONNECTED: "The connection to Hosthub stopped. Let Stelios know.",
  INTERNAL: "Something went wrong. Please try again.",
  NETWORK: "No internet connection. Please try again.",
};
