import type { IsoDate } from "@stay-ops/domain";
import { loadTurnovers, type CleaningKind, type TurnoverStatus } from "./cleaningSchedule";

/**
 * One cleaning as the cleaner sees it: the apartment, the kind and how many people (Stelios, 2026-10-14, no times).
 * Written out field by field on purpose: the cleaner link is public, so nothing about a guest (name, phone, email,
 * price) can slip through by adding a field to the schedule.
 */
export type CleanerTask = {
  id: string;
  /** "1 - Onar". */
  apartment: string;
  status: TurnoverStatus;
  kind: CleaningKind;
  /**
   * How many people come next (A-A, A) or are staying (S); beds depend on it. Babies count as children. Null when
   * nobody is booked or the booking did not say.
   */
  people: { adults: number; children: number } | null;
  /** True for A-A and A when nobody is booked after. */
  nobodyBooked: boolean;
};

export type CleanerDay = { day: IsoDate; tasks: CleanerTask[] };

/** The cleanings of one day for the public cleaner link. Cancelled ones are left out. */
export async function getCleanerDay(day: IsoDate): Promise<CleanerDay> {
  const list = await loadTurnovers(day, 1, { includeCancelled: false });
  const tasks = list.tasks
    .filter((t) => t.day === day)
    .map((t): CleanerTask => {
      const party = t.guest?.party ?? null;
      return {
        id: t.id,
        apartment: t.room.label,
        status: t.status,
        kind: t.kind,
        people: party ? { adults: party.adults, children: party.children + party.infants } : null,
        nobodyBooked: t.guest === null,
      };
    });
  return { day, tasks };
}
