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

function objectAtPath(r: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = r[key];
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
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
    "channel_type_code",
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
  const guest =
    objectAtPath(r, "guest") ??
    objectAtPath(r, "customer") ??
    objectAtPath(r, "guest_details") ??
    objectAtPath(r, "traveler");
  if (guest) {
    const n = pickString(guest, "name", "full_name", "first_name");
    if (n) return n;
    const first = pickString(guest, "first_name", "firstname");
    const last = pickString(guest, "last_name", "lastname");
    if (first || last) return `${first ?? ""} ${last ?? ""}`.trim();
  }
  return pickString(r, "guest_name", "guestName", "room_guest_name", "customer_name", "booker_name");
}

function pickNumber(r: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
    if (typeof v === "string" && v.trim().length > 0) {
      const parsed = Number(v.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readMoneyCents(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.round(parsed * 100);
    return undefined;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const cents = pickNumber(o, "cents");
    if (cents !== undefined) return Math.round(cents);
    const amount = pickNumber(o, "amount", "value");
    if (amount !== undefined) return Math.round(amount * 100);
  }
  return undefined;
}

function pickMoneyCents(r: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const cents = readMoneyCents(r[k]);
    if (cents !== undefined) return cents;
  }
  return undefined;
}

function pickCurrency(r: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const value = r[k];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = pickString(value as Record<string, unknown>, "currency");
      if (nested) return nested;
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
 * Trim + lowercase so upserts on `(channel, external_booking_id)` stay stable when Hosthub
 * sends the same reservation id with different casing. Hosthub treats these ids as opaque; API
 * calls use this same canonical value.
 */
function normalizeHosthubExternalId(value: string): string {
  return value.trim().toLowerCase();
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

  const reservationIdRaw = pickString(
    r,
    "id",
    "uuid",
    "reservationId",
    "reservation_id",
    "booking_id",
    "bookingId",
  );
  const listingIdRaw = pickListingId(r);
  const reservationId = reservationIdRaw ? normalizeHosthubExternalId(reservationIdRaw) : undefined;
  const listingId = listingIdRaw ? normalizeHosthubExternalId(listingIdRaw) : undefined;

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
  const guestObj =
    objectAtPath(r, "guest") ??
    objectAtPath(r, "customer") ??
    objectAtPath(r, "guest_details") ??
    objectAtPath(r, "traveler") ??
    {};
  const guestEmail =
    pickString(guestObj, "email", "guest_email", "mail", "booker_email") ??
    pickString(r, "guest_email", "guestEmail", "email", "booker_email", "customer_email");
  const guestPhone =
    pickString(guestObj, "phone", "phone_number", "mobile", "mobile_phone", "booker_phone") ??
    pickString(r, "guest_phone", "guestPhone", "phone", "guest_phone_number", "mobile_phone", "customer_phone");
  const guestAdults =
    pickNumber(guestObj, "adults", "adult_count", "number_of_adults") ??
    pickNumber(r, "guest_adults", "guestAdults", "adults", "number_of_adults");
  const guestChildren =
    pickNumber(guestObj, "children", "child_count", "number_of_children") ??
    pickNumber(r, "guest_children", "guestChildren", "children", "number_of_children");
  const guestInfants =
    pickNumber(guestObj, "infants", "infant_count", "number_of_infants") ??
    pickNumber(r, "guest_infants", "guestInfants", "infants", "number_of_infants");
  const guestTotal =
    pickNumber(guestObj, "total", "count", "guest_count", "number_of_guests") ??
    pickNumber(r, "guest_total", "guestTotal", "guest_count", "guestCount", "number_of_guests");
  const totalAmountCents = pickMoneyCents(r, "booking_value", "total_value", "total", "total_price");
  const cleaningFeeCents = pickMoneyCents(r, "cleaning_fee", "cleaningFee", "cleaning");
  const taxCents = pickMoneyCents(r, "taxes", "tax", "tax_amount");
  const payoutAmountCents = pickMoneyCents(r, "total_payout", "payout", "host_payout", "net_payout");
  const guestPaidCents = pickMoneyCents(r, "guest_paid", "amount_paid", "paid_amount");
  const currency = pickCurrency(r, "booking_value", "total_value", "total_payout", "guest_paid", "total", "currency");
  const action = pickString(r, "action", "action_type");
  const notes = pickString(r, "notes", "note", "remarks", "special_requests", "comment");

  return {
    reservationId,
    listingId,
    ...(listingName !== undefined ? { listingName } : {}),
    ...(guestName !== undefined ? { guestName } : {}),
    ...(guestEmail !== undefined ? { guestEmail } : {}),
    ...(guestPhone !== undefined ? { guestPhone } : {}),
    ...(guestAdults !== undefined ? { guestAdults } : {}),
    ...(guestChildren !== undefined ? { guestChildren } : {}),
    ...(guestInfants !== undefined ? { guestInfants } : {}),
    ...(guestTotal !== undefined ? { guestTotal } : {}),
    ...(totalAmountCents !== undefined ? { totalAmountCents } : {}),
    ...(currency !== undefined ? { currency } : {}),
    ...(cleaningFeeCents !== undefined ? { cleaningFeeCents } : {}),
    ...(taxCents !== undefined ? { taxCents } : {}),
    ...(payoutAmountCents !== undefined ? { payoutAmountCents } : {}),
    ...(guestPaidCents !== undefined ? { guestPaidCents } : {}),
    ...(action !== undefined ? { action } : {}),
    ...(notes !== undefined ? { notes } : {}),
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
  rawData: unknown[];
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
  const rawData: unknown[] = [];
  let maxUpdated: number | undefined;
  for (const item of arr) {
    const u = parseUpdatedUnix(item);
    if (u !== undefined) {
      maxUpdated = maxUpdated === undefined ? u : Math.max(maxUpdated, u);
    }
    const row = normalizeHosthubReservationRecord(item);
    if (row) {
      data.push(row);
      rawData.push(item);
    }
  }
  const skipped = arr.length - data.length;
  const nextPageUrl = extractNextPageUrl(o);
  const out: {
    data: HosthubReservationDto[];
    rawData: unknown[];
    nextPageUrl: string | null;
    skipped: number;
    maxUpdated?: number;
  } = {
    data,
    rawData,
    nextPageUrl,
    skipped,
  };
  if (maxUpdated !== undefined) {
    out.maxUpdated = maxUpdated;
  }
  return out;
}
