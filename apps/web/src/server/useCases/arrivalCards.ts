import type { Channel } from "@stay-ops/db";
import { dbDateToIso } from "@/server/time";
import { prisma } from "@/lib/prisma";
import { previousStaysForMany, type PreviousStays } from "./previousStays";
import { partyOf } from "./bookingSlice";

/** Everything printed on one guest arrival card (Κάρτα άφιξης). */
export type ArrivalCard = {
  id: string;
  guestName: string | null;
  phone: string | null;
  email: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  /** Adults + children; null when unknown. */
  partySize: number | null;
  checkin: string;
  checkout: string;
  nights: number;
  apartment: string | null;
  channel: Channel;
  /** The booking's own note first, then the notes written in Hosthub. Plain text only. */
  notes: string[];
  previousStays: PreviousStays;
};

const MAX_NOTES = 10;
const MAX_NOTE_LENGTH = 1000;

/**
 * The text of the notes Hosthub sent (`{ data: [{ status, content }] }`), oldest first, without deleted ones.
 * Any other shape gives nothing; the raw JSON is never passed on.
 */
export function extractNoteTexts(raw: unknown): string[] {
  const root = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const items = Array.isArray(raw) ? raw : Array.isArray(root?.data) ? root.data : [];
  const texts: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const note = item as Record<string, unknown>;
    if (typeof note.status === "string" && note.status.toLowerCase() === "deleted") continue;
    const content = typeof note.content === "string" ? note.content.trim() : "";
    if (content !== "") texts.push(content.slice(0, MAX_NOTE_LENGTH));
  }
  return texts;
}

/** The booking's note and Hosthub's notes as plain lines, without repeats. */
export function noteLines(notes: string | null, hosthubNotesRaw: unknown): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const text of [notes?.trim() ?? "", ...extractNoteTexts(hosthubNotesRaw)]) {
    const key = text.toLowerCase();
    if (text === "" || seen.has(key)) continue;
    seen.add(key);
    lines.push(text.slice(0, MAX_NOTE_LENGTH));
  }
  return lines.slice(0, MAX_NOTES);
}

/** Cards for the given bookings, in check-in order. Unknown ids are skipped. */
export async function getArrivalCards(ids: string[]): Promise<ArrivalCard[]> {
  const unique = [...new Set(ids)];
  const rows = await prisma.booking.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      guestName: true,
      guestPhone: true,
      guestEmail: true,
      guestAdults: true,
      guestChildren: true,
      guestInfants: true,
      guestTotal: true,
      checkinDate: true,
      checkoutDate: true,
      channel: true,
      notes: true,
      hosthubNotesRaw: true,
      // The apartment the guest arrives in (the first one, when they move mid-stay).
      assignments: {
        orderBy: { startDate: "asc" },
        take: 1,
        select: { room: { select: { displayName: true, code: true } } },
      },
    },
    orderBy: [{ checkinDate: "asc" }, { guestName: "asc" }, { id: "asc" }],
  });
  const previous = await previousStaysForMany(rows.map((r) => r.id));
  return rows.map((row) => {
    const party = partyOf(row);
    const arrival = row.assignments[0];
    return {
      id: row.id,
      guestName: row.guestName,
      phone: row.guestPhone?.trim() || null,
      email: row.guestEmail?.trim() || null,
      adults: row.guestAdults,
      children: row.guestChildren,
      infants: row.guestInfants,
      partySize: party === null ? null : party.adults + party.children,
      checkin: dbDateToIso(row.checkinDate),
      checkout: dbDateToIso(row.checkoutDate),
      nights: Math.round((row.checkoutDate.getTime() - row.checkinDate.getTime()) / 86_400_000),
      apartment: arrival ? (arrival.room.displayName ?? arrival.room.code) : null,
      channel: row.channel,
      notes: noteLines(row.notes, row.hosthubNotesRaw),
      previousStays: previous.get(row.id) ?? { sure: [], maybe: [] },
    };
  });
}
