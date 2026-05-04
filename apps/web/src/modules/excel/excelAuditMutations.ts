import { writeAuditSnapshot } from "@stay-ops/audit";
import { Prisma } from "@stay-ops/db";
import { prisma } from "@/lib/prisma";

export class ExcelListingNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;
  constructor(public readonly listingId: string) {
    super("Listing not found");
    this.name = "ExcelListingNotFoundError";
  }
}

export class ExcelLedgerEntryNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;
  constructor(public readonly entryId: string) {
    super("Ledger entry not found");
    this.name = "ExcelLedgerEntryNotFoundError";
  }
}

export async function patchExcelRentalConfigLabel(input: {
  index: 1 | 2 | 3 | 4;
  label: string;
  actorUserId: string;
  auditMeta?: Record<string, unknown>;
}) {
  const { index, label, actorUserId, auditMeta } = input;
  return prisma.$transaction(async (tx) => {
    let existing = await tx.excelRentalConfig.findUnique({ where: { id: 1 } });
    if (!existing) {
      existing = await tx.excelRentalConfig.create({ data: { id: 1 } });
    }
    const before = {
      label1: existing.label1,
      label2: existing.label2,
      label3: existing.label3,
      label4: existing.label4,
    };
    const data =
      index === 1
        ? { label1: label }
        : index === 2
          ? { label2: label }
          : index === 3
            ? { label3: label }
            : { label4: label };
    const updated = await tx.excelRentalConfig.update({
      where: { id: 1 },
      data,
    });
    const after = {
      label1: updated.label1,
      label2: updated.label2,
      label3: updated.label3,
      label4: updated.label4,
    };
    await writeAuditSnapshot(tx, {
      actorUserId,
      action: "excel_rental_config.update",
      entityType: "excel_rental_config",
      entityId: "1",
      before,
      after,
      meta: { index, ...(auditMeta ?? {}) },
    });
    return updated;
  });
}

export async function patchExcelListingRentalIndex(input: {
  listingId: string;
  rentalIndex: number | null;
  actorUserId: string;
  auditMeta?: Record<string, unknown>;
}) {
  const { listingId, rentalIndex, actorUserId, auditMeta } = input;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.sourceListing.findUnique({ where: { id: listingId } });
    if (!existing) {
      throw new ExcelListingNotFoundError(listingId);
    }
    const updated = await tx.sourceListing.update({
      where: { id: listingId },
      data: { rentalIndex },
    });
    await writeAuditSnapshot(tx, {
      actorUserId,
      action: "excel_listing.rental_index",
      entityType: "source_listing",
      entityId: listingId,
      before: { rentalIndex: existing.rentalIndex },
      after: { rentalIndex: updated.rentalIndex },
      meta: { listingId, ...(auditMeta ?? {}) },
    });
    return updated;
  });
}

export async function createExcelLedgerManualEntry(input: {
  year: number;
  manualName: string;
  manualMonth: number;
  actorUserId: string;
  auditMeta?: Record<string, unknown>;
}) {
  const { year, manualName, manualMonth, actorUserId, auditMeta } = input;
  return prisma.$transaction(async (tx) => {
    const entry = await tx.excelLedgerEntry.create({
      data: {
        year,
        bookingId: null,
        manualName,
        manualMonth,
        overrides: undefined,
      },
    });
    await writeAuditSnapshot(tx, {
      actorUserId,
      action: "excel_ledger_entry.create_manual",
      entityType: "excel_ledger_entry",
      entityId: entry.id,
      before: null,
      after: {
        year: entry.year,
        manualName: entry.manualName,
        manualMonth: entry.manualMonth,
        bookingId: entry.bookingId,
      },
      meta: { year, ...(auditMeta ?? {}) },
    });
    return entry;
  });
}

export async function upsertExcelLedgerBookingEntry(input: {
  year: number;
  bookingId: string;
  actorUserId: string;
  auditMeta?: Record<string, unknown>;
}) {
  const { year, bookingId, actorUserId, auditMeta } = input;
  return prisma.$transaction(async (tx) => {
    const prior = await tx.excelLedgerEntry.findUnique({
      where: { year_bookingId: { year, bookingId } },
    });
    const entry = await tx.excelLedgerEntry.upsert({
      where: {
        year_bookingId: {
          year,
          bookingId,
        },
      },
      create: {
        year,
        bookingId,
        manualName: null,
        manualMonth: null,
      },
      update: {},
    });
    await writeAuditSnapshot(tx, {
      actorUserId,
      action: prior ? "excel_ledger_entry.ensure_booking" : "excel_ledger_entry.create_booking",
      entityType: "excel_ledger_entry",
      entityId: entry.id,
      before: prior
        ? {
            year: prior.year,
            bookingId: prior.bookingId,
            manualName: prior.manualName,
            manualMonth: prior.manualMonth,
            overrides: prior.overrides,
          }
        : null,
      after: {
        year: entry.year,
        bookingId: entry.bookingId,
        manualName: entry.manualName,
        manualMonth: entry.manualMonth,
        overrides: entry.overrides,
      },
      meta: { bookingId, year, ...(auditMeta ?? {}) },
    });
    return entry;
  });
}

export async function patchExcelLedgerEntryOverrides(input: {
  entryId: string;
  nextOverrides: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  actorUserId: string;
  auditMeta?: Record<string, unknown>;
}) {
  const { entryId, nextOverrides, actorUserId, auditMeta } = input;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.excelLedgerEntry.findUnique({ where: { id: entryId } });
    if (!existing) {
      throw new ExcelLedgerEntryNotFoundError(entryId);
    }
    const updated = await tx.excelLedgerEntry.update({
      where: { id: entryId },
      data: { overrides: nextOverrides },
    });
    await writeAuditSnapshot(tx, {
      actorUserId,
      action: "excel_ledger_entry.update_overrides",
      entityType: "excel_ledger_entry",
      entityId: entryId,
      before: { overrides: existing.overrides },
      after: { overrides: updated.overrides },
      meta: {
        bookingId: existing.bookingId,
        year: existing.year,
        ...(auditMeta ?? {}),
      },
    });
    return updated;
  });
}

export async function deleteExcelLedgerManualEntry(input: {
  entryId: string;
  actorUserId: string;
  auditMeta?: Record<string, unknown>;
}) {
  const { entryId, actorUserId, auditMeta } = input;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.excelLedgerEntry.findUnique({ where: { id: entryId } });
    if (!existing) {
      throw new ExcelLedgerEntryNotFoundError(entryId);
    }
    if (existing.bookingId != null) {
      throw new Error("NOT_MANUAL_ENTRY");
    }
    await writeAuditSnapshot(tx, {
      actorUserId,
      action: "excel_ledger_entry.delete_manual",
      entityType: "excel_ledger_entry",
      entityId: entryId,
      before: {
        year: existing.year,
        manualName: existing.manualName,
        manualMonth: existing.manualMonth,
        overrides: existing.overrides,
      },
      after: null,
      meta: { year: existing.year, ...(auditMeta ?? {}) },
    });
    await tx.excelLedgerEntry.delete({ where: { id: entryId } });
  });
}

export async function clearExcelLedgerEntryOverrides(input: {
  entryId: string;
  actorUserId: string;
  auditMeta?: Record<string, unknown>;
}) {
  const { entryId, actorUserId, auditMeta } = input;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.excelLedgerEntry.findUnique({ where: { id: entryId } });
    if (!existing) {
      throw new ExcelLedgerEntryNotFoundError(entryId);
    }
    if (existing.bookingId == null) {
      throw new Error("NOT_BOOKING_ENTRY");
    }
    const updated = await tx.excelLedgerEntry.update({
      where: { id: entryId },
      data: { overrides: Prisma.JsonNull },
    });
    await writeAuditSnapshot(tx, {
      actorUserId,
      action: "excel_ledger_entry.clear_overrides",
      entityType: "excel_ledger_entry",
      entityId: entryId,
      before: { overrides: existing.overrides },
      after: { overrides: updated.overrides },
      meta: { bookingId: existing.bookingId, year: existing.year, ...(auditMeta ?? {}) },
    });
    return updated;
  });
}
