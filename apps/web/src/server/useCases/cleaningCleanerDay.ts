import type { IsoDate } from "@stay-ops/domain";
import { loadTurnovers, type TurnoverStatus } from "./cleaningSchedule";

/**
 * One cleaning as the cleaner sees it. Written out field by field on purpose: the cleaner link is public, so
 * nothing about a guest (name, phone, email, price) can slip through by adding a field to the schedule.
 */
export type CleanerTask = {
  id: string;
  apartment: string;
  color: string | null;
  status: TurnoverStatus;
  /** When the guest leaves (`HH:MM`). */
  leaveTime: string;
  start: string;
  end: string;
  /** Who arrives next in this apartment; null when nobody. */
  arrival: {
    sameDay: boolean;
    /** The arrival day, for when it is not the same day. */
    day: IsoDate;
    time: string;
    /** Beds depend on these; null when the booking did not say. */
    adults: number | null;
    children: number | null;
    infants: number | null;
  } | null;
  assigneeName: string | null;
  notes: string | null;
};

export type CleanerDay = { day: IsoDate; tasks: CleanerTask[] };

/** The cleanings of one day for the public cleaner link. Cancelled ones are left out. */
export async function getCleanerDay(day: IsoDate): Promise<CleanerDay> {
  const list = await loadTurnovers(day, 1, { includeCancelled: false });
  const tasks = list.tasks
    .filter((t) => t.day === day)
    .map((t): CleanerTask => ({
      id: t.id,
      apartment: t.room.name,
      color: t.room.color,
      status: t.status,
      leaveTime: t.leaving.time,
      start: t.start,
      end: t.end,
      arrival: t.next
        ? {
            sameDay: t.next.sameDay,
            day: t.next.checkin,
            time: t.next.time,
            adults: t.next.party?.adults ?? null,
            children: t.next.party?.children ?? null,
            infants: t.next.party?.infants ?? null,
          }
        : null,
      assigneeName: t.assigneeName,
      notes: t.notes,
    }));
  return { day, tasks };
}
