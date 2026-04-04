import { normalizeHosthubReservationRecord } from "../hosthub/normalize.js";
import type { HosthubReservationDto } from "../hosthub/types.dto.js";
import { HosthubReservationDtoSchema } from "../hosthub/types.dto.js";

const NESTED_KEYS = [
  "calendar_event",
  "calendarEvent",
  "reservation",
  "data",
  "payload",
  "body",
] as const;

export function extractHosthubReservationDto(parsed: unknown): HosthubReservationDto | null {
  const fromNorm = normalizeHosthubReservationRecord(parsed);
  if (fromNorm) {
    const strict = HosthubReservationDtoSchema.safeParse(fromNorm);
    return strict.success ? strict.data : null;
  }
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    for (const key of NESTED_KEYS) {
      const inner = o[key];
      const innerNorm = normalizeHosthubReservationRecord(inner);
      if (innerNorm) {
        const strict = HosthubReservationDtoSchema.safeParse(innerNorm);
        if (strict.success) {
          return strict.data;
        }
      }
    }
  }
  return null;
}
