import { HosthubReservationDtoSchema, type HosthubReservationDto } from "../hosthub/types.dto.js";

const NESTED_KEYS = ["reservation", "data", "payload", "body"] as const;

export function extractHosthubReservationDto(parsed: unknown): HosthubReservationDto | null {
  const direct = HosthubReservationDtoSchema.safeParse(parsed);
  if (direct.success) {
    return direct.data;
  }
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    for (const key of NESTED_KEYS) {
      const inner = o[key];
      const innerParsed = HosthubReservationDtoSchema.safeParse(inner);
      if (innerParsed.success) {
        return innerParsed.data;
      }
    }
  }
  return null;
}
