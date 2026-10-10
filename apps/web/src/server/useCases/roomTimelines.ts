import type { Occupant } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { dbDateToIso } from "@/server/time";

/**
 * Who is in which apartment (assignments) and which apartments are closed (manual blocks) in
 * `[windowStart, windowEnd)`, per room id, ready for the recommender.
 */
export async function loadTimelines(windowStart: Date, windowEnd: Date): Promise<Map<string, Occupant[]>> {
  const [assignments, blocks] = await Promise.all([
    prisma.assignment.findMany({
      where: { startDate: { lt: windowEnd }, endDate: { gt: windowStart } },
      select: {
        roomId: true,
        bookingId: true,
        startDate: true,
        endDate: true,
        booking: { select: { guestName: true } },
      },
    }),
    prisma.manualBlock.findMany({
      where: { startDate: { lt: windowEnd }, endDate: { gt: windowStart } },
      select: { id: true, roomId: true, startDate: true, endDate: true, reason: true },
    }),
  ]);

  const timelines = new Map<string, Occupant[]>();
  const add = (roomId: string, occupant: Occupant) =>
    timelines.set(roomId, [...(timelines.get(roomId) ?? []), occupant]);
  for (const a of assignments) {
    add(a.roomId, {
      kind: "booking",
      id: a.bookingId,
      stay: { checkin: dbDateToIso(a.startDate), checkout: dbDateToIso(a.endDate) },
      guestName: a.booking.guestName ?? undefined,
    });
  }
  for (const b of blocks) {
    add(b.roomId, {
      kind: "block",
      id: b.id,
      stay: { checkin: dbDateToIso(b.startDate), checkout: dbDateToIso(b.endDate) },
      reason: b.reason ?? undefined,
    });
  }
  return timelines;
}
