import type { BookingStatus } from "@stay-ops/db";

/** Compact booking fields stored on audit events (no rawPayload). */
export type BookingAuditSnapshot = {
  version: number;
  status: BookingStatus;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  guestAdults: number | null;
  guestChildren: number | null;
  guestInfants: number | null;
  guestTotal: number | null;
  totalAmountCents: number | null;
  currency: string | null;
  notes: string | null;
  action: string | null;
};

export type BookingAuditSnapshotRow = Pick<
  BookingAuditSnapshot,
  | "version"
  | "status"
  | "guestName"
  | "guestEmail"
  | "guestPhone"
  | "guestAdults"
  | "guestChildren"
  | "guestInfants"
  | "guestTotal"
  | "totalAmountCents"
  | "currency"
  | "notes"
  | "action"
>;

export function bookingToAuditSnapshot(row: BookingAuditSnapshotRow): BookingAuditSnapshot {
  return {
    version: row.version,
    status: row.status,
    guestName: row.guestName,
    guestEmail: row.guestEmail,
    guestPhone: row.guestPhone,
    guestAdults: row.guestAdults,
    guestChildren: row.guestChildren,
    guestInfants: row.guestInfants,
    guestTotal: row.guestTotal,
    totalAmountCents: row.totalAmountCents,
    currency: row.currency,
    notes: row.notes,
    action: row.action,
  };
}
