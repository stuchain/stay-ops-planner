import { writeAuditSnapshot } from "@stay-ops/audit";
import { Prisma } from "@stay-ops/db";
import {
  DomainError,
  incomeFor,
  isRentalIndex,
  LEDGER_COUNT_FIELDS,
  LEDGER_MONEY_FIELDS,
  LEDGER_TEXT_FIELDS,
  mergeLedgerPatch,
  readLedgerOverrides,
  type LedgerPatch,
} from "@stay-ops/domain";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const revert = z.literal("revert");
const text = z.union([z.string().trim().max(200), z.null(), revert]).optional();
const count = z.union([z.number().int().min(0).max(10_000), z.null(), revert]).optional();
/** Cents. Negative amounts are allowed for refunds and penalties (E3-4). */
const money = z.union([z.number().int().min(-100_000_000).max(100_000_000), z.null(), revert]).optional();

export const LedgerPatchSchema = z
  .object({
    ...Object.fromEntries(LEDGER_TEXT_FIELDS.map((k) => [k, text])),
    ...Object.fromEntries(LEDGER_COUNT_FIELDS.map((k) => [k, count])),
    ...Object.fromEntries(LEDGER_MONEY_FIELDS.map((k) => [k, money])),
    rentalIndex: z.union([z.number().int().refine(isRentalIndex), z.null(), revert]).optional(),
  } as Record<string, z.ZodTypeAny>)
  .strict()
  .refine((p) => Object.keys(p).length > 0, "Empty patch");

const MONEY_KEYS = new Set<string>(LEDGER_MONEY_FIELDS);

export type UpdateLedgerRowInput = {
  /** A booking row, or a manual row by its entry id. */
  target: { bookingId: string } | { entryId: string };
  /** The row's `version` the person was looking at (0 for a row never corrected). */
  expectedVersion: number;
  patch: LedgerPatch;
  actorUserId: string;
};

export type UpdateLedgerRowResult = { entryId: string; version: number };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function sameOverrides(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => k in b && a[k] === b[k]);
}

async function actorId(tx: Prisma.TransactionClient, userId: string): Promise<string | null> {
  return (await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))?.id ?? null;
}

async function updateInTransaction(
  tx: Prisma.TransactionClient,
  input: UpdateLedgerRowInput,
): Promise<UpdateLedgerRowResult> {
  const { target } = input;
  if ("entryId" in target) {
    await tx.$executeRaw`SELECT id FROM ledger_entries WHERE id = ${target.entryId} FOR UPDATE`;
  } else {
    // Lock the booking, so two first corrections of the same row queue instead of racing.
    await tx.$executeRaw`SELECT id FROM bookings WHERE id = ${target.bookingId} FOR UPDATE`;
  }
  const entry =
    "entryId" in target
      ? await tx.ledgerEntry.findUnique({ where: { id: target.entryId } })
      : await tx.ledgerEntry.findUnique({ where: { bookingId: target.bookingId } });
  if ("entryId" in target && !entry) throw new DomainError("NOT_FOUND");

  const before = readLedgerOverrides(entry?.overrides);
  const after = mergeLedgerPatch(before, input.patch);
  if ((entry?.version ?? 0) !== input.expectedVersion) {
    // A save that went through but whose answer was lost, sent again: the row already reads as asked.
    if (entry && sameOverrides(before, after)) return { entryId: entry.id, version: entry.version };
    throw new DomainError("BOOKING_CHANGED");
  }

  // Remember Hosthub's amounts when an amount is corrected, to flag a later change there (E3-6).
  let hosthubSnapshot: Prisma.InputJsonValue | undefined;
  if ("bookingId" in target && Object.keys(input.patch).some((k) => MONEY_KEYS.has(k))) {
    const booking = await tx.booking.findUnique({ where: { id: target.bookingId } });
    if (!booking) throw new DomainError("NOT_FOUND");
    const income = incomeFor({
      channel: booking.channel,
      status: booking.status,
      totalValueCents: booking.totalValueCents,
      bookingValueCents: booking.totalAmountCents,
      payoutCents: booking.payoutAmountCents,
      cleaningFeeCents: booking.cleaningFeeCents,
      currency: booking.currency,
    });
    hosthubSnapshot = { grossCents: income.grossCents, payoutCents: income.payoutCents };
  }

  const data = {
    overrides: after as Prisma.InputJsonValue,
    ...(hosthubSnapshot !== undefined ? { hosthubSnapshot } : {}),
  };
  const saved = entry
    ? await tx.ledgerEntry.update({ where: { id: entry.id }, data: { ...data, version: { increment: 1 } } })
    : await tx.ledgerEntry.create({
        data: { ...data, bookingId: (target as { bookingId: string }).bookingId, version: 1 },
      });

  await writeAuditSnapshot(tx, {
    actorUserId: await actorId(tx, input.actorUserId),
    action: "ledger.update",
    entityType: "ledger_entry",
    entityId: saved.id,
    before: { overrides: before, version: entry?.version ?? 0 },
    after: { overrides: after, version: saved.version },
    meta: "bookingId" in target ? { bookingId: target.bookingId } : {},
  });
  return { entryId: saved.id, version: saved.version };
}

/**
 * Saves corrections on one ledger row. Two people editing the same row: the second
 * gets BOOKING_CHANGED and reloads (E3-11); the first-edit race is retried once.
 */
export async function updateLedgerRow(input: UpdateLedgerRowInput): Promise<UpdateLedgerRowResult> {
  try {
    return await prisma.$transaction((tx) => updateInTransaction(tx, input));
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return prisma.$transaction((tx) => updateInTransaction(tx, input));
  }
}

export type AddManualRowInput = {
  year: number;
  month: number;
  label: string;
  patch?: LedgerPatch | undefined;
  /** Made by the page for each save; the same save sent again returns the row it already added. */
  requestId?: string | undefined;
  actorUserId: string;
};

async function rowForRequest(requestId: string | undefined): Promise<UpdateLedgerRowResult | null> {
  if (requestId === undefined) return null;
  const row = await prisma.ledgerEntry.findUnique({ where: { requestId }, select: { id: true, version: true } });
  return row ? { entryId: row.id, version: row.version } : null;
}

/** A row with no booking behind it (a phone booking paid in cash, an adjustment). */
export async function addManualLedgerRow(input: AddManualRowInput): Promise<UpdateLedgerRowResult> {
  const existing = await rowForRequest(input.requestId);
  if (existing) return existing;
  try {
    return await addManualInTransaction(input);
  } catch (err) {
    // Both copies of the save arrived together: the other one added the row.
    if (isUniqueViolation(err)) {
      const raced = await rowForRequest(input.requestId);
      if (raced) return raced;
    }
    throw err;
  }
}

function addManualInTransaction(input: AddManualRowInput): Promise<UpdateLedgerRowResult> {
  return prisma.$transaction(async (tx) => {
    const overrides = mergeLedgerPatch({}, input.patch ?? {});
    const created = await tx.ledgerEntry.create({
      data: {
        year: input.year,
        month: input.month,
        label: input.label.trim(),
        overrides: overrides as Prisma.InputJsonValue,
        requestId: input.requestId ?? null,
        version: 1,
      },
    });
    await writeAuditSnapshot(tx, {
      actorUserId: await actorId(tx, input.actorUserId),
      action: "ledger.add_manual",
      entityType: "ledger_entry",
      entityId: created.id,
      before: null,
      after: { year: input.year, month: input.month, label: created.label, overrides },
    });
    return { entryId: created.id, version: created.version };
  });
}

export type EditManualRowInput = {
  entryId: string;
  expectedVersion: number;
  month?: number | undefined;
  label?: string | undefined;
  actorUserId: string;
};

/** Locks a manual row. `stale` means it changed since the person opened it; the caller decides what that means. */
async function lockedManual(tx: Prisma.TransactionClient, entryId: string, expectedVersion: number) {
  await tx.$executeRaw`SELECT id FROM ledger_entries WHERE id = ${entryId} FOR UPDATE`;
  const entry = await tx.ledgerEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.bookingId !== null) return null;
  return { entry, stale: entry.version !== expectedVersion };
}

/** Renames a manual row or moves it to another month (E3-10). */
export async function editManualLedgerRow(input: EditManualRowInput): Promise<UpdateLedgerRowResult> {
  return prisma.$transaction(async (tx) => {
    const locked = await lockedManual(tx, input.entryId, input.expectedVersion);
    if (!locked) throw new DomainError("NOT_FOUND");
    const { entry, stale } = locked;
    if (stale) {
      const label = input.label?.trim();
      const done =
        (label === undefined || label === entry.label) && (input.month === undefined || input.month === entry.month);
      if (done) return { entryId: entry.id, version: entry.version };
      throw new DomainError("BOOKING_CHANGED");
    }
    const saved = await tx.ledgerEntry.update({
      where: { id: entry.id },
      data: {
        ...(input.label !== undefined ? { label: input.label.trim() } : {}),
        ...(input.month !== undefined ? { month: input.month } : {}),
        version: { increment: 1 },
      },
    });
    await writeAuditSnapshot(tx, {
      actorUserId: await actorId(tx, input.actorUserId),
      action: "ledger.edit_manual",
      entityType: "ledger_entry",
      entityId: entry.id,
      before: { label: entry.label, month: entry.month },
      after: { label: saved.label, month: saved.month },
    });
    return { entryId: saved.id, version: saved.version };
  });
}

export async function deleteManualLedgerRow(input: {
  entryId: string;
  expectedVersion: number;
  actorUserId: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const locked = await lockedManual(tx, input.entryId, input.expectedVersion);
    // Already gone: a delete sent again after its answer was lost.
    if (!locked) return;
    const { entry, stale } = locked;
    if (stale) throw new DomainError("BOOKING_CHANGED");
    await tx.ledgerEntry.delete({ where: { id: entry.id } });
    await writeAuditSnapshot(tx, {
      actorUserId: await actorId(tx, input.actorUserId),
      action: "ledger.delete_manual",
      entityType: "ledger_entry",
      entityId: entry.id,
      before: { year: entry.year, month: entry.month, label: entry.label, overrides: entry.overrides },
      after: null,
    });
  });
}
