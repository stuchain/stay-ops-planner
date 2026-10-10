import { writeAuditSnapshot } from "@stay-ops/audit";
import { Prisma } from "@stay-ops/db";
import { DomainError } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { partyOf } from "./bookingSlice";

/** The details a person can change in the app. */
export const EDITABLE_FIELDS = ["guestName", "partySize", "notes"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** The booking columns behind each field. Sync leaves these alone while the field is edited. */
const COLUMNS = {
  guestName: ["guestName"],
  partySize: ["guestAdults", "guestChildren", "guestTotal"],
  notes: ["notes"],
} as const satisfies Record<EditableField, readonly string[]>;

type Column = (typeof COLUMNS)[EditableField][number];
type Dict = Record<string, unknown>;

type EditRow = {
  id: string;
  version: number;
  guestName: string | null;
  guestAdults: number | null;
  guestChildren: number | null;
  guestInfants: number | null;
  guestTotal: number | null;
  notes: string | null;
  localOverrides: Prisma.JsonValue;
  hosthubValues: Prisma.JsonValue;
};

export const editSelect = {
  id: true,
  version: true,
  guestName: true,
  guestAdults: true,
  guestChildren: true,
  guestInfants: true,
  guestTotal: true,
  notes: true,
  localOverrides: true,
  hosthubValues: true,
} satisfies Prisma.BookingSelect;

function dict(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {};
}

function party(row: Pick<EditRow, "guestAdults" | "guestChildren" | "guestInfants" | "guestTotal">): number | null {
  const p = partyOf(row);
  return p === null ? null : p.adults + p.children;
}

/** Empty text means "no value". */
function cleanText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** What each field holds now, as a person sees it. */
export function effectiveFields(row: EditRow): Record<EditableField, string | number | null> {
  return { guestName: row.guestName, partySize: party(row), notes: row.notes };
}

/** What Hosthub sent for a field the person changed, or null when the field is not changed (or was changed before Hosthub values were kept). */
export type HosthubValue = { value: string | number | null } | null;

export function hosthubValueOf(row: EditRow, field: EditableField): HosthubValue {
  const overrides = dict(row.localOverrides);
  const columns: readonly Column[] = COLUMNS[field];
  if (!columns.some((c) => overrides[c] === true)) return null;
  const stored = dict(row.hosthubValues);
  if (!columns.every((c) => c in stored)) return null;
  if (field === "guestName") return { value: (stored.guestName as string | null) ?? null };
  if (field === "notes") return { value: (stored.notes as string | null) ?? null };
  const asRow = {
    guestAdults: (stored.guestAdults as number | null) ?? null,
    guestChildren: (stored.guestChildren as number | null) ?? null,
    guestInfants: row.guestInfants,
    guestTotal: (stored.guestTotal as number | null) ?? null,
  };
  return { value: party(asRow) };
}

/** Per-field "Από Hosthub" info for the panel. */
export function localEdits(row: EditRow): Record<EditableField, { hosthub: string | number | null } | null> {
  const out = {} as Record<EditableField, { hosthub: string | number | null } | null>;
  for (const field of EDITABLE_FIELDS) {
    const h = hosthubValueOf(row, field);
    out[field] = h === null ? null : { hosthub: h.value };
  }
  return out;
}

export type UpdateDetailsInput = {
  bookingId: string;
  expectedVersion: number;
  guestName?: string | undefined;
  partySize?: number | undefined;
  notes?: string | undefined;
  actorUserId: string;
};

export type ResetFieldInput = {
  bookingId: string;
  field: EditableField;
  expectedVersion: number;
  actorUserId: string;
};

/**
 * Locks the booking. `stale` means it changed since the person opened it: the caller refuses with BOOKING_CHANGED
 * unless the booking already reads as asked, which is what a save that went through before a lost answer looks
 * like when it is sent again (E2-7).
 */
async function lockAndCheck(tx: Prisma.TransactionClient, bookingId: string, expectedVersion: number) {
  await tx.$executeRaw`SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE`;
  const row = await tx.booking.findUnique({ where: { id: bookingId }, select: editSelect });
  if (!row) throw new DomainError("NOT_FOUND");
  return { row, stale: row.version !== expectedVersion };
}

/** Restores the Hosthub value of one field and clears the marks that kept sync away from it. */
function resetData(row: EditRow, field: EditableField, overrides: Dict, stored: Dict): Dict {
  const data: Dict = {};
  for (const column of COLUMNS[field]) {
    if (column in stored) data[column] = stored[column];
    delete overrides[column];
    delete stored[column];
  }
  return data;
}

function overrideJson(value: Dict): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return Object.keys(value).length > 0 ? (value as Prisma.InputJsonValue) : Prisma.DbNull;
}

function audit(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  action: string,
  row: EditRow,
  before: Dict,
  after: Dict,
  fields: EditableField[],
) {
  return writeAuditSnapshot(tx, {
    actorUserId,
    action,
    entityType: "booking",
    entityId: row.id,
    before,
    after,
    meta: { fields, bookingId: row.id },
  });
}

/**
 * Change the guest name, the number of people or the notes of a booking. The new value is kept
 * (sync leaves it alone) and Hosthub's own value is remembered so it can be shown and restored.
 * Typing Hosthub's value again simply resets the field.
 */
export async function updateBookingDetails(input: UpdateDetailsInput): Promise<{ version: number }> {
  return prisma.$transaction(async (tx) => {
    const { row, stale } = await lockAndCheck(tx, input.bookingId, input.expectedVersion);
    const overrides = { ...dict(row.localOverrides) };
    const stored = { ...dict(row.hosthubValues) };
    const before = effectiveFields(row);
    const data: Dict = {};
    const changed: EditableField[] = [];

    for (const field of EDITABLE_FIELDS) {
      const wanted = input[field];
      if (wanted === undefined) continue;
      const next = field === "partySize" ? (wanted as number) : cleanText(wanted as string);
      if (field === "guestName" && next === null) throw new DomainError("VALIDATION");
      if (field === "partySize" && (!Number.isInteger(next) || (next as number) < 1 || (next as number) > 99)) {
        throw new DomainError("VALIDATION");
      }
      if (next === before[field]) continue;

      const hosthub = hosthubValueOf(row, field);
      const hosthubNow = hosthub ? hosthub.value : before[field];
      if (hosthub && next === hosthubNow) {
        Object.assign(data, resetData(row, field, overrides, stored));
        changed.push(field);
        continue;
      }
      for (const column of COLUMNS[field]) {
        if (overrides[column] !== true) stored[column] = row[column] ?? null;
        overrides[column] = true;
      }
      if (field === "partySize") {
        data.guestAdults = next;
        data.guestChildren = 0;
        data.guestTotal = (next as number) + (row.guestInfants ?? 0);
      } else {
        data[field] = next;
      }
      changed.push(field);
    }

    if (changed.length === 0) return { version: row.version };
    if (stale) throw new DomainError("BOOKING_CHANGED");

    const updated = await tx.booking.update({
      where: { id: row.id },
      data: {
        ...data,
        localOverrides: overrideJson(overrides),
        hosthubValues: overrideJson(stored),
        version: { increment: 1 },
      },
      select: editSelect,
    });
    const after = effectiveFields(updated);
    const pick = (values: Record<EditableField, unknown>) => Object.fromEntries(changed.map((f) => [f, values[f]]));
    await audit(tx, input.actorUserId, "booking.details_edit", row, pick(before), pick(after), changed);
    return { version: updated.version };
  });
}

/** Take back Hosthub's value for one field ("Επαναφορά"). */
export async function resetBookingField(input: ResetFieldInput): Promise<{ version: number }> {
  return prisma.$transaction(async (tx) => {
    const { row, stale } = await lockAndCheck(tx, input.bookingId, input.expectedVersion);
    const overrides = { ...dict(row.localOverrides) };
    const stored = { ...dict(row.hosthubValues) };
    if (!COLUMNS[input.field].some((c) => overrides[c] === true)) return { version: row.version };
    if (stale) throw new DomainError("BOOKING_CHANGED");
    const before = effectiveFields(row);
    const data = resetData(row, input.field, overrides, stored);
    const updated = await tx.booking.update({
      where: { id: row.id },
      data: {
        ...data,
        localOverrides: overrideJson(overrides),
        hosthubValues: overrideJson(stored),
        version: { increment: 1 },
      },
      select: editSelect,
    });
    const after = effectiveFields(updated);
    await audit(
      tx,
      input.actorUserId,
      "booking.field_reset",
      row,
      { [input.field]: before[input.field] },
      { [input.field]: after[input.field] },
      [input.field],
    );
    return { version: updated.version };
  });
}
