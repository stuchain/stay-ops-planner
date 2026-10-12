import { writeAuditSnapshot } from "@stay-ops/audit";
import { DomainError } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";

export const GUEST_NOTE_MAX = 2000;

/**
 * Save the team's note about the guest of a booking (empty text clears it). It is the app's own field, so sync
 * never touches it and the booking's version (used by moves and detail edits) does not change.
 */
export async function setGuestNote(input: {
  bookingId: string;
  note: string;
  actorUserId: string;
}): Promise<{ guestNote: string | null }> {
  const next = input.note.trim() === "" ? null : input.note.trim();
  if (next !== null && next.length > GUEST_NOTE_MAX) throw new DomainError("VALIDATION");
  return prisma.$transaction(async (tx) => {
    const row = await tx.booking.findUnique({ where: { id: input.bookingId }, select: { id: true, guestNote: true } });
    if (!row) throw new DomainError("NOT_FOUND");
    if (row.guestNote === next) return { guestNote: next };
    await tx.booking.update({ where: { id: row.id }, data: { guestNote: next } });
    await writeAuditSnapshot(tx, {
      actorUserId: input.actorUserId,
      action: "booking.guest_note",
      entityType: "booking",
      entityId: row.id,
      before: { guestNote: row.guestNote },
      after: { guestNote: next },
      meta: { bookingId: row.id },
    });
    return { guestNote: next };
  });
}
