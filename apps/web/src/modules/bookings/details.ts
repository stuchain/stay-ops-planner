import type { BookingStatus, Channel, Prisma } from "@stay-ops/db";

type Dict = Record<string, unknown>;

function asObject(value: unknown): Dict {
  return value && typeof value === "object" ? (value as Dict) : {};
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickString(obj: Dict, keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(obj[key]);
    if (value) return value;
  }
  return null;
}

function pickNumber(obj: Dict, keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(obj[key]);
    if (value !== null) return value;
  }
  return null;
}

function pickGuest(root: Dict, guestObj: Dict, keys: string[]): string | null {
  for (const key of keys) {
    const nested = asString(guestObj[key]);
    if (nested) return nested;
    const top = asString(root[key]);
    if (top) return top;
  }
  return null;
}

function dateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function centsToAmount(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return cents / 100;
}

/** Hosthub calendar-event style `{ cents, currency }` on `raw_payload`. */
export function readCentsFromField(obj: Dict, field: string): number | null {
  const v = obj[field];
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v / 100;
  if (typeof v === "string") {
    const parsed = Number(v.trim());
    if (Number.isFinite(parsed)) return parsed;
    return null;
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Dict;
    const cents = asNumber(o.cents);
    if (cents !== null) return cents / 100;
    const amount = asNumber(o.amount ?? o.value);
    if (amount !== null) return amount;
  }
  return null;
}

const CHANNEL_TAX_BUCKET_DEFS: Array<{ key: string; label: string }> = [
  {
    key: "tax_channel_collected_host_remitted",
    label: "Extra taxes collected by channel (host remitted)",
  },
  {
    key: "tax_channel_collected_channel_remitted",
    label: "Extra taxes collected by channel (channel remitted)",
  },
  {
    key: "tax_host_collected_host_remitted",
    label: "Tax host collected (host remitted)",
  },
  { key: "tax_channel_sponsored", label: "Tax channel sponsored" },
];

export type BookingMoneyTaxBreakdownItem = { key: string; label: string; amount: number };
export type BookingMoneyDailyBreakdownItem = { date: string; amount: number };
export type BookingMoneyExtraIncludedItem = { label: string; amount: number };

function buildBookingComHosthubMoneyExtras(raw: Dict): BookingMoneyExtraIncludedItem[] {
  const out: BookingMoneyExtraIncludedItem[] = [];
  const cleaning = readCentsFromField(raw, "cleaning_fee");
  if (cleaning !== null && cleaning > 0) {
    out.push({
      label: `Cleaning fee (${cleaning.toFixed(2)} €) included in Cleaning fee.`,
      amount: cleaning,
    });
  }
  const other = readCentsFromField(raw, "other_fees");
  if (other !== null && other > 0) {
    out.push({
      label: `Other fees (${other.toFixed(2)} €) included in Other fees.`,
      amount: other,
    });
  }
  return out;
}

function buildBookingComDailyBreakdown(
  dateFrom: string | null,
  nights: number,
  bookingValue: number | null,
): BookingMoneyDailyBreakdownItem[] {
  if (!dateFrom || nights <= 0 || bookingValue === null) return [];
  const start = new Date(`${dateFrom}T12:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return [];
  const totalCents = Math.round(bookingValue * 100);
  const baseCents = Math.floor(totalCents / nights);
  const remainder = totalCents - baseCents * nights;
  const rows: BookingMoneyDailyBreakdownItem[] = [];
  for (let i = 0; i < nights; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const y = d.getUTCFullYear();
    const m = `${d.getUTCMonth() + 1}`.padStart(2, "0");
    const day = `${d.getUTCDate()}`.padStart(2, "0");
    const nightCents = baseCents + (i < remainder ? 1 : 0);
    rows.push({ date: `${y}-${m}-${day}`, amount: nightCents / 100 });
  }
  return rows;
}

function buildBookingComTaxBreakdown(raw: Dict): BookingMoneyTaxBreakdownItem[] {
  return CHANNEL_TAX_BUCKET_DEFS.map(({ key, label }) => {
    const amount = readCentsFromField(raw, key) ?? 0;
    return { key, label, amount };
  });
}

function extraTaxesByChannelFromRaw(raw: Dict): number | null {
  const a = readCentsFromField(raw, "tax_channel_collected_host_remitted");
  const b = readCentsFromField(raw, "tax_channel_collected_channel_remitted");
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function sumGuestParts(parts: Array<number | null | undefined>): number | null {
  let sum = 0;
  let hasAny = false;
  for (const part of parts) {
    if (part === null || part === undefined) continue;
    hasAny = true;
    sum += part;
  }
  return hasAny ? sum : null;
}

export type BookingListItemDto = {
  id: string;
  channel: Channel;
  externalBookingId: string;
  status: BookingStatus;
  checkinDate: string;
  checkoutDate: string;
  createdAt: string;
  updatedAt: string;
  nights: number;
  guestName: string;
  guestCount: number | null;
  totalValue: number | null;
  currency: string | null;
  cleaningFee: number | null;
  taxes: number | null;
  payout: number | null;
  guestPaid: number | null;
  action: string | null;
  assignedRentalId: string | null;
  assignedRentalName: string | null;
};

export type BookingDetailDto = BookingListItemDto & {
  createdAt: string;
  updatedAt: string;
  sourceListingId: string | null;
  sourceListingName: string | null;
  assignment: {
    id: string;
    roomId: string;
    startDate: string;
    endDate: string;
    version: number;
  } | null;
  contact: {
    email: string | null;
    phone: string | null;
    country: string | null;
    id: string | null;
  };
  guests: {
    adults: number | null;
    children: number | null;
    infants: number | null;
    total: number | null;
    childrenAges: string | null;
  };
  money: {
    total: number | null;
    /** Hosthub `total_value` (Booking.com); same as guest paid when channel-collected taxes excluded from total. */
    totalValue: number | null;
    currency: string | null;
    cleaningFee: number | null;
    taxes: number | null;
    payout: number | null;
    guestPaid: number | null;
    otherFees: number | null;
    paymentCharges: number | null;
    serviceFeeHost: number | null;
    serviceFeeHostBase: number | null;
    serviceFeeHostVat: number | null;
    extraTaxes: number | null;
    collectedByChannel: number | null;
    /** Booking.com / Hosthub calendar-event fields (null when channel !== booking). */
    bookingValue: number | null;
    extraTaxesByChannel: number | null;
    serviceFeeGuest: number | null;
    taxBreakdown: BookingMoneyTaxBreakdownItem[];
    dailyBreakdown: BookingMoneyDailyBreakdownItem[];
    extrasIncluded: BookingMoneyExtraIncludedItem[];
  };
  notes: string | null;
  hosthub: {
    calendarEventRaw: unknown;
    notesRaw: unknown;
    grTaxesRaw: unknown;
  };
  notesTimeline: Array<{
    id: string | null;
    created: string | null;
    updated: string | null;
    status: string | null;
    content: string | null;
  }>;
  payloadSections: Array<{
    id: string;
    title: string;
    fields: Array<{ key: string; label: string; value: string }>;
  }>;
  rawPayload: unknown;
};

export type BookingWithDetailRelations = Prisma.BookingGetPayload<{
  include: {
    assignment: true;
    sourceListing: { select: { title: true } };
  };
}>;

export type BookingRow = Prisma.BookingGetPayload<Record<string, never>>;
export type BookingListRow = Prisma.BookingGetPayload<{
  include: {
    assignment: {
      include: {
        room: {
          select: {
            id: true;
            code: true;
            displayName: true;
          };
        };
      };
    };
  };
}>;

function assignedRentalNameFromBooking(
  booking: BookingRow | BookingListRow | BookingWithDetailRelations,
): string | null {
  if (!("assignment" in booking) || !booking.assignment) return null;
  const assignmentWithRoom = booking.assignment as typeof booking.assignment & {
    room?: { id?: string | null; code?: string | null; displayName?: string | null } | null;
  };
  return (
    assignmentWithRoom.room?.displayName ??
    assignmentWithRoom.room?.code ??
    assignmentWithRoom.room?.id ??
    null
  );
}

function assignedRentalIdFromBooking(
  booking: BookingRow | BookingListRow | BookingWithDetailRelations,
): string | null {
  if (!("assignment" in booking) || !booking.assignment) return null;
  const assignmentWithRoom = booking.assignment as typeof booking.assignment & {
    room?: { id?: string | null } | null;
  };
  return assignmentWithRoom.room?.id ?? booking.assignment.roomId ?? null;
}

export function bookingListItemFromModel(
  booking: BookingRow | BookingListRow | BookingWithDetailRelations,
): BookingListItemDto {
  const raw = asObject(booking.rawPayload);
  const guestObj = asObject(raw.guest ?? raw.customer ?? raw.guest_details);

  const guestName =
    booking.guestName ??
    pickGuest(raw, guestObj, ["name", "full_name", "guest_name", "guestName", "customer_name"]) ??
    "Guest";
  const guestCount =
    booking.guestTotal ??
    sumGuestParts([booking.guestAdults, booking.guestChildren, booking.guestInfants]) ??
    sumGuestParts([
      pickNumber(guestObj, ["adults", "adult_count"]),
      pickNumber(guestObj, ["children", "child_count"]),
      pickNumber(guestObj, ["infants", "infant_count"]),
    ]) ??
    sumGuestParts([
      pickNumber(raw, ["adults"]),
      pickNumber(raw, ["children"]),
      pickNumber(raw, ["infants"]),
    ]) ??
    pickNumber(guestObj, ["total", "count", "guests", "guest_count"]) ??
    pickNumber(raw, ["guests", "guest_count", "total_guests"]);
  const totalValue =
    centsToAmount(booking.totalAmountCents) ??
    pickNumber(raw, ["total", "total_price", "total_value", "amount_total", "reservation_total"]);
  const currency = booking.currency ?? pickString(raw, ["currency", "currency_code"]);
  const action = booking.action ?? pickString(raw, ["action", "action_type", "reason", "source_action"]);
  const cleaningFee = centsToAmount(booking.cleaningFeeCents) ?? pickNumber(raw, ["cleaning_fee", "cleaningFee"]);
  const taxes = centsToAmount(booking.taxCents) ?? pickNumber(raw, ["taxes", "tax"]);
  const payout = centsToAmount(booking.payoutAmountCents) ?? pickNumber(raw, ["payout", "host_payout"]);
  const guestPaid = centsToAmount(booking.guestPaidCents) ?? pickNumber(raw, ["guest_paid"]);
  const assignedRentalId = assignedRentalIdFromBooking(booking);
  const assignedRentalName = assignedRentalNameFromBooking(booking);

  return {
    id: booking.id,
    channel: booking.channel,
    externalBookingId: booking.externalBookingId,
    status: booking.status,
    checkinDate: dateStr(booking.checkinDate),
    checkoutDate: dateStr(booking.checkoutDate),
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
    nights: booking.nights,
    guestName,
    guestCount,
    totalValue,
    currency,
    cleaningFee,
    taxes,
    payout,
    guestPaid,
    action,
    assignedRentalId,
    assignedRentalName,
  };
}

function bookingMoneyFromModel(booking: BookingWithDetailRelations): BookingDetailDto["money"] {
  const raw = asObject(booking.rawPayload);
  const taxesObj = asObject(booking.hosthubGrTaxesRaw);

  const totalLegacy =
    centsToAmount(booking.totalAmountCents) ??
    pickNumber(raw, ["total", "total_price", "total_value", "amount_total", "reservation_total"]);
  const currency = booking.currency ?? pickString(raw, ["currency", "currency_code"]);
  const cleaningFeeLegacy = centsToAmount(booking.cleaningFeeCents) ?? pickNumber(raw, ["cleaning_fee", "cleaningFee"]);
  const taxesLegacy = centsToAmount(booking.taxCents) ?? pickNumber(raw, ["taxes", "tax"]);
  const payoutLegacy = centsToAmount(booking.payoutAmountCents) ?? pickNumber(raw, ["payout", "host_payout"]);
  const guestPaidLegacy = centsToAmount(booking.guestPaidCents) ?? pickNumber(raw, ["guest_paid"]);

  const emptyHosthub: Pick<
    BookingDetailDto["money"],
    | "bookingValue"
    | "extraTaxesByChannel"
    | "serviceFeeGuest"
    | "taxBreakdown"
    | "dailyBreakdown"
    | "extrasIncluded"
    | "totalValue"
  > = {
    totalValue: null,
    bookingValue: null,
    extraTaxesByChannel: null,
    serviceFeeGuest: null,
    taxBreakdown: [],
    dailyBreakdown: [],
    extrasIncluded: [],
  };

  if (booking.channel !== "booking" && booking.channel !== "airbnb") {
    return {
      total: totalLegacy,
      totalValue: null,
      currency,
      cleaningFee: cleaningFeeLegacy,
      taxes: taxesLegacy,
      payout: payoutLegacy,
      guestPaid: guestPaidLegacy,
      otherFees: pickNumber(raw, ["other_fees", "otherFees"]),
      paymentCharges: pickNumber(raw, ["payment_charges", "paymentCharges", "payment_fees"]),
      serviceFeeHost:
        pickNumber(raw, ["service_fee_host", "serviceFeeHost"]) ??
        pickNumber(taxesObj, ["service_fee_host", "serviceFeeHost"]),
      serviceFeeHostBase:
        pickNumber(raw, ["service_fee_host_base", "serviceFeeHostBase"]) ??
        pickNumber(taxesObj, ["service_fee_host_base", "serviceFeeHostBase"]),
      serviceFeeHostVat:
        pickNumber(raw, ["service_fee_host_vat", "serviceFeeHostVat"]) ??
        pickNumber(taxesObj, ["service_fee_host_vat", "serviceFeeHostVat"]),
      extraTaxes:
        pickNumber(raw, ["extra_taxes", "extraTaxes"]) ?? pickNumber(taxesObj, ["extra_taxes", "extraTaxes"]),
      collectedByChannel:
        pickNumber(raw, ["collected_by_channel", "collectedByChannel"]) ??
        pickNumber(taxesObj, ["collected_by_channel", "collectedByChannel"]),
      ...emptyHosthub,
    };
  }

  const isBookingCom = booking.channel === "booking";

  const bookingValue = readCentsFromField(raw, "booking_value");
  const totalValue = readCentsFromField(raw, "total_value");
  const cleaningFee = readCentsFromField(raw, "cleaning_fee") ?? cleaningFeeLegacy;
  const otherFees = readCentsFromField(raw, "other_fees") ?? pickNumber(raw, ["other_fees", "otherFees"]);
  const payout = readCentsFromField(raw, "total_payout") ?? payoutLegacy;
  const guestPaid = readCentsFromField(raw, "guest_paid") ?? guestPaidLegacy;
  const paymentCharges = readCentsFromField(raw, "payment_charges") ?? pickNumber(raw, ["payment_charges", "paymentCharges"]);
  const serviceFeeHost =
    readCentsFromField(raw, "service_fee_host") ??
    pickNumber(raw, ["service_fee_host", "serviceFeeHost"]) ??
    pickNumber(taxesObj, ["service_fee_host", "serviceFeeHost"]);
  const serviceFeeGuest = readCentsFromField(raw, "service_fee_guest");
  const taxesFromPayload = readCentsFromField(raw, "taxes");
  const extraTaxesByChannel = isBookingCom ? extraTaxesByChannelFromRaw(raw) : null;

  const dateFrom = pickString(raw, ["date_from", "dateFrom"]);
  const dailyBreakdown = isBookingCom
    ? buildBookingComDailyBreakdown(dateFrom, booking.nights, bookingValue)
    : [];
  const taxBreakdown = buildBookingComTaxBreakdown(raw);
  const extrasIncluded = buildBookingComHosthubMoneyExtras(raw);

  const serviceFeeHostBase =
    readCentsFromField(raw, "service_fee_host_base") ??
    pickNumber(raw, ["service_fee_host_base", "serviceFeeHostBase"]) ??
    pickNumber(taxesObj, ["service_fee_host_base", "serviceFeeHostBase"]);
  const serviceFeeHostVat =
    readCentsFromField(raw, "service_fee_host_vat") ??
    pickNumber(raw, ["service_fee_host_vat", "serviceFeeHostVat"]) ??
    pickNumber(taxesObj, ["service_fee_host_vat", "serviceFeeHostVat"]);
  const extraTaxes =
    pickNumber(raw, ["extra_taxes", "extraTaxes"]) ?? pickNumber(taxesObj, ["extra_taxes", "extraTaxes"]);
  const collectedByChannel =
    pickNumber(raw, ["collected_by_channel", "collectedByChannel"]) ??
    pickNumber(taxesObj, ["collected_by_channel", "collectedByChannel"]);

  return {
    total: totalValue ?? totalLegacy,
    totalValue: totalValue ?? null,
    currency,
    cleaningFee,
    taxes: taxesFromPayload ?? taxesLegacy,
    payout,
    guestPaid,
    otherFees,
    paymentCharges,
    serviceFeeHost,
    serviceFeeHostBase,
    serviceFeeHostVat,
    extraTaxes,
    collectedByChannel,
    bookingValue,
    extraTaxesByChannel,
    serviceFeeGuest,
    taxBreakdown,
    dailyBreakdown,
    extrasIncluded,
  };
}

export function bookingDetailFromModel(booking: BookingWithDetailRelations): BookingDetailDto {
  const base = bookingListItemFromModel(booking);
  const raw = asObject(booking.rawPayload);
  const guestObj = asObject(raw.guest ?? raw.customer ?? raw.guest_details);

  return {
    ...base,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
    sourceListingId: booking.sourceListingId,
    sourceListingName: booking.sourceListing?.title ?? null,
    assignment: booking.assignment
      ? {
          id: booking.assignment.id,
          roomId: booking.assignment.roomId,
          startDate: dateStr(booking.assignment.startDate),
          endDate: dateStr(booking.assignment.endDate),
          version: booking.assignment.version,
        }
      : null,
    contact: {
      email: booking.guestEmail ?? pickGuest(raw, guestObj, ["email", "guest_email", "mail"]),
      phone: booking.guestPhone ?? pickGuest(raw, guestObj, ["phone", "phone_number", "mobile"]),
      country: pickGuest(raw, guestObj, ["country", "country_code", "guest_country", "nationality"]),
      id: pickGuest(raw, guestObj, ["id", "id_number", "identification", "passport", "passport_number"]),
    },
    guests: {
      adults: booking.guestAdults ?? pickNumber(guestObj, ["adults", "adult_count"]) ?? pickNumber(raw, ["adults"]),
      children:
        booking.guestChildren ?? pickNumber(guestObj, ["children", "child_count"]) ?? pickNumber(raw, ["children"]),
      infants: booking.guestInfants ?? pickNumber(guestObj, ["infants", "infant_count"]) ?? pickNumber(raw, ["infants"]),
      total:
        booking.guestTotal ??
        pickNumber(guestObj, ["total", "count", "guests", "guest_count"]) ??
        pickNumber(raw, ["guests", "guest_count", "total_guests"]),
      childrenAges:
        pickString(guestObj, ["children_ages", "child_ages", "childrenAges"]) ??
        pickString(raw, ["children_ages", "child_ages", "childrenAges"]),
    },
    money: bookingMoneyFromModel(booking),
    notes: booking.notes ?? pickString(raw, ["notes", "note", "internal_notes"]),
    hosthub: {
      calendarEventRaw: booking.hosthubCalendarEventRaw,
      notesRaw: booking.hosthubNotesRaw,
      grTaxesRaw: booking.hosthubGrTaxesRaw,
    },
    notesTimeline: extractNotesTimeline(booking.hosthubNotesRaw),
    payloadSections: buildPayloadSections([
      booking.hosthubCalendarEventRaw,
      booking.hosthubNotesRaw,
      booking.hosthubGrTaxesRaw,
      booking.rawPayload,
    ]),
    rawPayload: booking.rawPayload,
  };
}

function extractNotesTimeline(value: unknown): BookingDetailDto["notesTimeline"] {
  const root = asObject(value);
  const arr = Array.isArray(root.data) ? root.data : [];
  return arr.map((item) => {
    const obj = asObject(item);
    return {
      id: asString(obj.id),
      created: asString(obj.created),
      updated: asString(obj.updated),
      status: asString(obj.status),
      content: asString(obj.content),
    };
  });
}

function titleCase(text: string): string {
  return text
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value.trim().length > 0 ? value : "-";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.length === 0
      ? "[]"
      : value
          .map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item)))
          .join(", ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function flattenPayload(
  value: unknown,
  prefix: string,
  out: Array<{ key: string; value: unknown }>,
  seen: Set<unknown>,
): void {
  if (value === null || value === undefined) {
    out.push({ key: prefix, value });
    return;
  }
  if (typeof value !== "object") {
    out.push({ key: prefix, value });
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push({ key: prefix, value: [] });
      return;
    }
    for (let i = 0; i < value.length; i += 1) {
      const nextKey = prefix ? `${prefix}[${i}]` : `[${i}]`;
      flattenPayload(value[i], nextKey, out, seen);
    }
    return;
  }

  const obj = value as Dict;
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    out.push({ key: prefix, value: {} });
    return;
  }
  for (const key of keys) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    flattenPayload(obj[key], nextKey, out, seen);
  }
}

function sectionIdForKey(path: string): string {
  const key = path.toLowerCase();
  if (
    key.includes("guest") ||
    key.includes("email") ||
    key.includes("phone") ||
    key.includes("adults") ||
    key.includes("children") ||
    key.includes("infants")
  ) {
    return "guest_contact";
  }
  if (
    key.includes("booking_value") ||
    key.includes("total_payout") ||
    key.includes("tax") ||
    key.includes("paid") ||
    key.includes("currency") ||
    key.includes("fee") ||
    key.includes("price") ||
    key.includes("amount")
  ) {
    return "financial";
  }
  if (key.includes("source") || key.includes("channel")) return "source";
  if (key.includes("rental") || key.includes("listing")) return "rental";
  if (key.includes("date") || key.includes("check") || key.includes("night") || key.includes("status")) {
    return "lifecycle";
  }
  if (key.includes("identification") || key.includes("passport") || key.includes("vat") || key.includes("id")) {
    return "identification";
  }
  if (key.includes("note") || key.includes("memo") || key.includes("comment") || key.includes("message")) {
    return "notes_meta";
  }
  if (key.includes("type") || key.includes("url") || key.includes("object")) return "core";
  return "additional";
}

function sectionTitle(sectionId: string): string {
  const titles: Record<string, string> = {
    core: "Core",
    guest_contact: "Guest and Contact",
    financial: "Financial",
    source: "Source",
    rental: "Rental",
    lifecycle: "Lifecycle",
    identification: "Identification",
    notes_meta: "Notes and Meta",
    additional: "Additional Fields",
  };
  return titles[sectionId] ?? titleCase(sectionId);
}

function buildPayloadSections(sources: unknown[]): BookingDetailDto["payloadSections"] {
  const flattened: Array<{ key: string; value: unknown }> = [];
  const seenObjects = new Set<unknown>();
  for (const source of sources) {
    flattenPayload(source, "", flattened, seenObjects);
  }

  const dedup = new Set<string>();
  const grouped = new Map<string, Array<{ key: string; label: string; value: string }>>();
  for (const item of flattened) {
    if (!item.key) continue;
    const dedupKey = `${item.key}::${stringifyValue(item.value)}`;
    if (dedup.has(dedupKey)) continue;
    dedup.add(dedupKey);
    const sectionId = sectionIdForKey(item.key);
    const section = grouped.get(sectionId) ?? [];
    section.push({
      key: item.key,
      label: titleCase(item.key.split(".").pop() ?? item.key),
      value: stringifyValue(item.value),
    });
    grouped.set(sectionId, section);
  }

  const preferredOrder = [
    "core",
    "guest_contact",
    "financial",
    "source",
    "rental",
    "lifecycle",
    "identification",
    "notes_meta",
    "additional",
  ];

  const sections: BookingDetailDto["payloadSections"] = [];
  for (const sectionId of preferredOrder) {
    const fields = grouped.get(sectionId);
    if (!fields || fields.length === 0) continue;
    fields.sort((a, b) => a.key.localeCompare(b.key));
    sections.push({
      id: sectionId,
      title: sectionTitle(sectionId),
      fields,
    });
  }
  return sections;
}

export function mergeEditablePayload(currentPayload: unknown, updates: Dict): Dict {
  const raw = asObject(currentPayload);
  const guest = asObject(raw.guest);
  const mergedGuest: Dict = { ...guest };

  const assignIfDefined = (obj: Dict, key: string, value: unknown) => {
    if (value !== undefined) obj[key] = value;
  };

  assignIfDefined(mergedGuest, "name", updates.guestName);
  assignIfDefined(mergedGuest, "email", updates.email);
  assignIfDefined(mergedGuest, "phone", updates.phone);
  assignIfDefined(mergedGuest, "adults", updates.adults);
  assignIfDefined(mergedGuest, "children", updates.children);
  assignIfDefined(mergedGuest, "infants", updates.infants);
  assignIfDefined(mergedGuest, "total", updates.totalGuests);

  const merged: Dict = {
    ...raw,
    guest: mergedGuest,
  };
  assignIfDefined(merged, "total_price", updates.totalValue);
  assignIfDefined(merged, "currency", updates.currency);
  assignIfDefined(merged, "notes", updates.notes);
  assignIfDefined(merged, "action", updates.action);

  return merged;
}
