import type { HosthubReservationDto } from "./types.dto.js";

function pickString(r: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim().length > 0) {
      return v.trim();
    }
  }
  return undefined;
}

/** Reduce ISO-8601 or date-only strings to `YYYY-MM-DD` when possible. */
export function coerceHosthubDateField(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const prefix = trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(prefix)) {
    return prefix;
  }
  return trimmed;
}

function mapStatusRaw(raw: string): HosthubReservationDto["status"] {
  const s = raw.toLowerCase();
  if (s.includes("cancel")) {
    return "cancelled";
  }
  if (s.includes("pending") || s.includes("inquiry") || s.includes("request")) {
    return "pending";
  }
  return "confirmed";
}

/**
 * Maps a single JSON object from Hosthub list/webhook payloads into our canonical DTO.
 * Accepts common camelCase and snake_case field names; confirm against https://www.hosthub.com/docs/api/
 */
export function normalizeHosthubReservationRecord(raw: unknown): HosthubReservationDto | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const r = raw as Record<string, unknown>;

  const reservationId = pickString(
    r,
    "reservationId",
    "reservation_id",
    "id",
    "uuid",
    "booking_id",
    "bookingId",
  );
  const listingId = pickString(
    r,
    "listingId",
    "listing_id",
    "rental_id",
    "rentalId",
    "property_id",
    "propertyId",
  );

  const checkInRaw = pickString(
    r,
    "checkIn",
    "check_in",
    "arrival",
    "checkin_date",
    "start_date",
    "from",
  );
  const checkOutRaw = pickString(
    r,
    "checkOut",
    "check_out",
    "departure",
    "checkout_date",
    "end_date",
    "to",
  );

  if (!reservationId || !listingId || !checkInRaw || !checkOutRaw) {
    return null;
  }

  const statusRaw = pickString(r, "status", "state", "booking_status", "bookingStatus") ?? "confirmed";
  const status = mapStatusRaw(statusRaw);

  const listingChannel = pickString(
    r,
    "listingChannel",
    "listing_channel",
    "channel",
    "source",
    "platform",
  );

  return {
    reservationId,
    listingId,
    status,
    checkIn: coerceHosthubDateField(checkInRaw),
    checkOut: coerceHosthubDateField(checkOutRaw),
    ...(listingChannel !== undefined ? { listingChannel } : {}),
  };
}

function extractReservationArray(o: Record<string, unknown>): unknown[] | null {
  for (const k of ["data", "reservations", "items", "results", "bookings"]) {
    const v = o[k];
    if (Array.isArray(v)) {
      return v;
    }
  }
  return null;
}

function extractNextCursor(o: Record<string, unknown>): string | null | undefined {
  const candidates = [
    o.next_cursor,
    o.nextCursor,
    o.cursor,
    o.next_page_token,
    o.nextPageToken,
    o.next_page,
    o.next,
  ];
  for (const c of candidates) {
    if (c === undefined) {
      continue;
    }
    if (c === null) {
      return null;
    }
    if (typeof c === "string") {
      return c.length > 0 ? c : null;
    }
    if (typeof c === "number") {
      return String(c);
    }
  }
  return undefined;
}

/** Normalizes list response shapes documented under https://www.hosthub.com/docs/api/ (and common JSON:API-style wrappers). */
export function normalizeHosthubReservationPagePayload(input: unknown): {
  data: HosthubReservationDto[];
  nextCursor: string | null | undefined;
} | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const o = input as Record<string, unknown>;
  const arr = extractReservationArray(o);
  if (!arr) {
    return null;
  }
  const data: HosthubReservationDto[] = [];
  for (const item of arr) {
    const row = normalizeHosthubReservationRecord(item);
    if (row) {
      data.push(row);
    }
  }
  return {
    data,
    nextCursor: extractNextCursor(o),
  };
}
