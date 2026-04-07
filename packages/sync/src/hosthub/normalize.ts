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

function pickListingId(r: Record<string, unknown>): string | undefined {
  const rental = r.rental;
  if (rental !== null && typeof rental === "object" && !Array.isArray(rental)) {
    const id = pickString(rental as Record<string, unknown>, "id", "rentalId", "rental_id");
    if (id) {
      return id;
    }
  }
  return pickString(
    r,
    "listingId",
    "listing_id",
    "rental_id",
    "rentalId",
    "property_id",
    "propertyId",
  );
}

function pickListingChannel(r: Record<string, unknown>): string | undefined {
  const src = r.source;
  if (src !== null && typeof src === "object" && !Array.isArray(src)) {
    const fromObj = pickString(src as Record<string, unknown>, "name", "channel_type_code", "channelTypeCode");
    if (fromObj) {
      return fromObj;
    }
  }
  return pickString(
    r,
    "listingChannel",
    "listing_channel",
    "channel",
    "source",
    "platform",
  );
}

function pickListingName(r: Record<string, unknown>): string | undefined {
  const rental = r.rental;
  if (rental !== null && typeof rental === "object" && !Array.isArray(rental)) {
    const n = pickString(rental as Record<string, unknown>, "name");
    if (n) return n;
  }
  return pickString(r, "listing_name", "listingName", "property_name", "propertyName");
}

function pickGuestName(r: Record<string, unknown>): string | undefined {
  const guest = r.guest;
  if (guest !== null && typeof guest === "object" && !Array.isArray(guest)) {
    const n = pickString(guest as Record<string, unknown>, "name", "full_name");
    if (n) return n;
  }
  return pickString(r, "guest_name", "guestName", "room_guest_name");
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

function parseUpdatedUnix(raw: unknown): number | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const u = (raw as Record<string, unknown>).updated;
  if (typeof u === "number" && Number.isFinite(u)) {
    return u;
  }
  if (typeof u === "string" && /^\d+$/.test(u.trim())) {
    return Number.parseInt(u.trim(), 10);
  }
  return undefined;
}

/**
 * Maps a single JSON object from Hosthub list/webhook payloads into our canonical DTO.
 * Calendar events: stable `id`, `date_from`/`date_to`, nested `rental`, `source`; skips `Hold` rows.
 */
export function normalizeHosthubReservationRecord(raw: unknown): HosthubReservationDto | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const r = raw as Record<string, unknown>;

  const typeRaw = pickString(r, "type");
  if (typeRaw && typeRaw.toLowerCase() === "hold") {
    return null;
  }

  const reservationId = pickString(
    r,
    "id",
    "uuid",
    "reservationId",
    "reservation_id",
    "booking_id",
    "bookingId",
  );
  const listingId = pickListingId(r);

  const checkInRaw = pickString(
    r,
    "date_from",
    "dateFrom",
    "checkIn",
    "check_in",
    "arrival",
    "checkin_date",
    "start_date",
    "from",
  );
  const checkOutRaw = pickString(
    r,
    "date_to",
    "dateTo",
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

  let status = mapStatusRaw(pickString(r, "status", "state", "booking_status", "bookingStatus") ?? "confirmed");

  if (r.is_visible === false) {
    status = "cancelled";
  }
  const cancelledAt = pickString(r, "cancelled_at", "cancelledAt");
  if (cancelledAt) {
    status = "cancelled";
  }

  const listingChannel = pickListingChannel(r);
  const listingName = pickListingName(r);
  const guestName = pickGuestName(r);

  return {
    reservationId,
    listingId,
    ...(listingName !== undefined ? { listingName } : {}),
    ...(guestName !== undefined ? { guestName } : {}),
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

function extractNextPageUrl(o: Record<string, unknown>): string | null {
  const nav = o.navigation;
  if (nav !== null && typeof nav === "object" && !Array.isArray(nav)) {
    const next = (nav as Record<string, unknown>).next;
    if (next === null) {
      return null;
    }
    if (typeof next === "string" && next.trim().length > 0) {
      return next.trim();
    }
  }
  const legacy = extractNextCursor(o);
  if (legacy === null) {
    return null;
  }
  if (legacy === undefined) {
    return null;
  }
  if (legacy.startsWith("http://") || legacy.startsWith("https://")) {
    return legacy;
  }
  return null;
}

/** Normalizes list response shapes documented under https://www.hosthub.com/docs/api/ (and common JSON:API-style wrappers). */
export function normalizeHosthubReservationPagePayload(input: unknown): {
  data: HosthubReservationDto[];
  nextPageUrl: string | null;
  skipped: number;
  maxUpdated?: number;
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
  let maxUpdated: number | undefined;
  for (const item of arr) {
    const u = parseUpdatedUnix(item);
    if (u !== undefined) {
      maxUpdated = maxUpdated === undefined ? u : Math.max(maxUpdated, u);
    }
    const row = normalizeHosthubReservationRecord(item);
    if (row) {
      data.push(row);
    }
  }
  const skipped = arr.length - data.length;
  const nextPageUrl = extractNextPageUrl(o);
  const out: {
    data: HosthubReservationDto[];
    nextPageUrl: string | null;
    skipped: number;
    maxUpdated?: number;
  } = {
    data,
    nextPageUrl,
    skipped,
  };
  if (maxUpdated !== undefined) {
    out.maxUpdated = maxUpdated;
  }
  return out;
}
