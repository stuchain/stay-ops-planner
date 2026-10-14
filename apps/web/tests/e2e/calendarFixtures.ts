import bcrypt from "bcryptjs";
import { BookingStatus, Channel, PrismaClient } from "@prisma/client";

/**
 * Deterministic data owned by the new-calendar journey specs. Everything is relative to today (UTC, the
 * same day `APP_TIMEZONE=Etc/UTC` gives the server) and is rebuilt before every test.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://stayops:stayops@127.0.0.1:5432/stayops?schema=e2e";

export const CAL_USER = { email: "cal-e2e@stayops.local", password: "Cal_E2E_Password_12+" } as const;

const PREFIX = "cal-e2e-";
const ROOM_PREFIX = "CAL-";

export const ROOM = { alpha: "Cal Alpha", beta: "Cal Beta", gamma: "Cal Gamma" } as const;
export const GUEST = {
  placedInAlpha: "Alice Placed",
  moverInBeta: "Bob Mover",
  trayClick: "Tina Tray",
  trayDrag: "Dora Drag",
  pending: "Pam Pending",
  boundary: "Boris Boundary",
  late: "Carol Late",
  arrivesTomorrow: "Nikos Tomorrow",
  leavesTomorrow: "Dimitra Leaving",
  cancelledTomorrow: "Cora Cancelled",
} as const;

let client: PrismaClient | undefined;
function db(): PrismaClient {
  client ??= new PrismaClient({ datasourceUrl: DATABASE_URL });
  return client;
}

export async function closeCalendarFixtures(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}

function utcDay(offset: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The first day of a month that is at least 18 days away, so the boundary booking starts after the other
 * fixtures and is not yet under way. Returned as a day offset from today.
 */
function monthBoundaryOffset(): number {
  const today = utcDay(0);
  for (let months = 1; months <= 2; months++) {
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + months, 1));
    const offset = Math.round((first.getTime() - today.getTime()) / 86_400_000);
    if (offset >= 18) return offset;
  }
  throw new Error("unreachable");
}

export type CalendarFixtures = {
  /** Dates (ISO) of the booking that straddles a month boundary. */
  boundary: { checkin: string; checkout: string; firstOfMonth: string };
};

type NewBooking = {
  key: string;
  guest: string;
  from: number;
  nights: number;
  roomId?: string;
  status?: BookingStatus;
};

async function createBooking(b: NewBooking): Promise<void> {
  const checkinDate = utcDay(b.from);
  const checkoutDate = utcDay(b.from + b.nights);
  const booking = await db().booking.create({
    data: {
      channel: Channel.direct,
      externalBookingId: `${PREFIX}${b.key}`,
      status: b.status ?? BookingStatus.confirmed,
      checkinDate,
      checkoutDate,
      nights: b.nights,
      guestName: b.guest,
      guestAdults: 2,
      guestChildren: 0,
      guestInfants: 0,
      guestTotal: 2,
      currency: "EUR",
    },
  });
  if (b.roomId) {
    await db().assignment.create({
      data: { bookingId: booking.id, roomId: b.roomId, startDate: checkinDate, endDate: checkoutDate },
    });
  }
}

/** Books `guest` into an apartment behind the page's back, so a move that looked fine fails on the server. */
export async function occupyRoom(roomKey: "alpha" | "beta" | "gamma", guest: string, from: number, nights: number) {
  const room = await db().room.findUniqueOrThrow({ where: { code: `${ROOM_PREFIX}${roomKey}` } });
  await createBooking({ key: `late-${roomKey}`, guest, from, nights, roomId: room.id });
}

/** Rebuilds the calendar user, the three apartments and the bookings. Safe to call before every test. */
export async function resetCalendarFixtures(): Promise<CalendarFixtures> {
  const prisma = db();
  const where = { externalBookingId: { startsWith: PREFIX } };
  await prisma.cleaningTask.deleteMany({ where: { booking: where } });
  await prisma.assignment.deleteMany({ where: { booking: where } });
  await prisma.booking.deleteMany({ where });

  await prisma.user.upsert({
    where: { email: CAL_USER.email },
    update: { isActive: true },
    create: {
      email: CAL_USER.email,
      passwordHash: await bcrypt.hash(CAL_USER.password, 4),
      isActive: true,
      role: "admin",
    },
  });

  const roomIds = new Map<string, string>();
  const defs = [
    { key: "alpha", name: ROOM.alpha, color: "#0F766E" },
    { key: "beta", name: ROOM.beta, color: "#4338CA" },
    { key: "gamma", name: ROOM.gamma, color: "#BE185D" },
  ];
  for (const [index, d] of defs.entries()) {
    const data = { displayName: d.name, color: d.color, isActive: true, maxGuests: 4, calendarSortIndex: -100 + index };
    const room = await prisma.room.upsert({
      where: { code: `${ROOM_PREFIX}${d.key}` },
      update: data,
      create: { code: `${ROOM_PREFIX}${d.key}`, ...data },
    });
    roomIds.set(d.key, room.id);
  }

  const boundary = monthBoundaryOffset();
  const bookings: NewBooking[] = [
    // Alpha and Beta hold the same dates, so each is busy for the other's guest.
    { key: "alice", guest: GUEST.placedInAlpha, from: 3, nights: 3, roomId: roomIds.get("alpha")! },
    { key: "bob", guest: GUEST.moverInBeta, from: 3, nights: 3, roomId: roomIds.get("beta")! },
    // Waiting for an apartment.
    { key: "tina", guest: GUEST.trayClick, from: 8, nights: 3 },
    { key: "dora", guest: GUEST.trayDrag, from: 9, nights: 3 },
    { key: "pam", guest: GUEST.pending, from: 14, nights: 3, status: BookingStatus.pending },
    // Four nights across the first of a month, in Gamma.
    { key: "boris", guest: GUEST.boundary, from: boundary - 2, nights: 4, roomId: roomIds.get("gamma")! },
    // The Today screen: one stay ends and one begins tomorrow (both in Gamma, which is free then), and a
    // cancelled arrival tomorrow that must not show.
    { key: "nikos", guest: GUEST.arrivesTomorrow, from: 1, nights: 2, roomId: roomIds.get("gamma")! },
    { key: "dimitra", guest: GUEST.leavesTomorrow, from: -2, nights: 3, roomId: roomIds.get("gamma")! },
    { key: "cora", guest: GUEST.cancelledTomorrow, from: 1, nights: 2, status: BookingStatus.cancelled },
  ];
  for (const b of bookings) await createBooking(b);

  return {
    boundary: {
      checkin: iso(utcDay(boundary - 2)),
      checkout: iso(utcDay(boundary + 2)),
      firstOfMonth: iso(utcDay(boundary)),
    },
  };
}

/** A tray booking months away, and who holds Alpha on the same dates; see `addFarTrayFixture`. */
export const FAR = { guest: "Fabio Faraway", blocker: "Alma Already", from: 150, nights: 4 } as const;

/**
 * A booking waiting for an apartment five months ahead, far off the screen the calendar opens on, with Alpha
 * already taken on those dates. Call after `resetCalendarFixtures`, which also removes it.
 */
export async function addFarTrayFixture(): Promise<void> {
  const alpha = (await db().room.findUniqueOrThrow({ where: { code: `${ROOM_PREFIX}alpha` } })).id;
  await createBooking({ key: "fabio", guest: FAR.guest, from: FAR.from, nights: FAR.nights });
  await createBooking({ key: "alma", guest: FAR.blocker, from: FAR.from - 1, nights: 3, roomId: alpha });
}

/** Guests added by `addScrollFixtures`, for the scrolling and past-stays specs. */
export const SCROLL_GUEST = {
  longStay: "Lena Long",
  twentyMonthsAgo: "Olga Old",
  farAhead: "Fiona Future",
  pastPlaced: "Paula Past",
  pastUnplacedA: "Ursula Unplaced",
  pastUnplacedB: "Victor Unplaced",
} as const;

/** Day offsets (from today) of the scroll fixtures, so specs can scroll to them. */
export const SCROLL_FROM = {
  longStay: -110,
  twentyMonthsAgo: -600,
  farAhead: 480,
  pastPlaced: -20,
  pastUnplacedA: -32,
  pastUnplacedB: -30,
} as const;

/**
 * Extra stays far from today for the scrolling specs: a 60-night stay, one 20 months back, one 16 months ahead,
 * a finished stay with an apartment and two overlapping finished stays that never got one.
 * Call after `resetCalendarFixtures`, which also removes them.
 */
export async function addScrollFixtures(): Promise<void> {
  const room = async (key: string) =>
    (await db().room.findUniqueOrThrow({ where: { code: `${ROOM_PREFIX}${key}` } })).id;
  const alpha = await room("alpha");
  const beta = await room("beta");
  const bookings: NewBooking[] = [
    { key: "lena", guest: SCROLL_GUEST.longStay, from: SCROLL_FROM.longStay, nights: 60, roomId: alpha },
    { key: "olga", guest: SCROLL_GUEST.twentyMonthsAgo, from: SCROLL_FROM.twentyMonthsAgo, nights: 3, roomId: beta },
    { key: "fiona", guest: SCROLL_GUEST.farAhead, from: SCROLL_FROM.farAhead, nights: 3, roomId: beta },
    { key: "paula", guest: SCROLL_GUEST.pastPlaced, from: SCROLL_FROM.pastPlaced, nights: 2, roomId: beta },
    { key: "ursula", guest: SCROLL_GUEST.pastUnplacedA, from: SCROLL_FROM.pastUnplacedA, nights: 4 },
    { key: "victor", guest: SCROLL_GUEST.pastUnplacedB, from: SCROLL_FROM.pastUnplacedB, nights: 3 },
  ];
  for (const b of bookings) await createBooking(b);
}
