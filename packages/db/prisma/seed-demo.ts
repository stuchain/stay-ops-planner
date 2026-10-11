/**
 * Demo data for local development and preview databases: the four apartments and
 * realistic bookings around today. Never run against production.
 *
 *   DATABASE_URL=... pnpm --filter @stay-ops/db seed:demo
 */
import "./load-env.js";
import { BookingStatus, Channel, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PREFIX = "demo-";

const ROOMS = [
  { code: "demo-onar", displayName: "Onar", maxGuests: 3, preferredForLargeParty: false, color: "#0F766E" },
  { code: "demo-cosmos", displayName: "Cosmos", maxGuests: 4, preferredForLargeParty: true, color: "#4338CA" },
  { code: "demo-iris", displayName: "Iris", maxGuests: 3, preferredForLargeParty: false, color: "#BE185D" },
  { code: "demo-helios", displayName: "Helios", maxGuests: 4, preferredForLargeParty: true, color: "#A65F00" },
] as const;

type DemoBooking = {
  guest: string;
  from: number;
  nights: number;
  adults: number;
  children?: number;
  channel: Channel;
  room: number | null;
  status?: BookingStatus;
  cents?: number;
};

/** Offsets in days from today. `room` is an index into ROOMS, or null for the tray. */
const BOOKINGS: DemoBooking[] = [
  { guest: "Maria Konstantinou", from: -3, nights: 5, adults: 2, channel: Channel.airbnb, room: 0, cents: 52000 },
  {
    guest: "Katarzyna Nowak",
    from: -1,
    nights: 4,
    adults: 2,
    children: 2,
    channel: Channel.booking,
    room: 1,
    cents: 61000,
  },
  { guest: "Sophie Martin", from: 2, nights: 3, adults: 2, channel: Channel.direct, room: 2, cents: 33000 },
  { guest: "Giorgos Alexiou", from: 0, nights: 7, adults: 3, channel: Channel.airbnb, room: 3, cents: 84000 },
  { guest: "Lukas Weber", from: 4, nights: 2, adults: 1, channel: Channel.booking, room: 0, cents: 19000 },
  { guest: "Elena Rossi", from: 3, nights: 6, adults: 4, channel: Channel.airbnb, room: 1, cents: 99000 },
  { guest: "Nikos Papadopoulos", from: 7, nights: 4, adults: 2, channel: Channel.direct, room: 3, cents: 46000 },
  {
    guest: "Anna Svensson",
    from: 9,
    nights: 5,
    adults: 2,
    children: 1,
    channel: Channel.booking,
    room: 2,
    cents: 58000,
  },
  { guest: "James Carter", from: 12, nights: 3, adults: 2, channel: Channel.airbnb, room: 0, cents: 36000 },
  { guest: "Dimitra Ioannou", from: 5, nights: 3, adults: 4, channel: Channel.booking, room: null, cents: 42000 },
  { guest: "Pierre Dubois", from: 8, nights: 2, adults: 2, channel: Channel.airbnb, room: null, cents: 24000 },
  { guest: "Hana Kobayashi", from: 15, nights: 4, adults: 3, channel: Channel.booking, room: null, cents: 47000 },
  {
    guest: "Thomas Müller",
    from: 20,
    nights: 5,
    adults: 2,
    channel: Channel.booking,
    room: null,
    status: BookingStatus.pending,
    cents: 51000,
  },
  {
    guest: "Laura García",
    from: 25,
    nights: 6,
    adults: 2,
    children: 2,
    channel: Channel.airbnb,
    room: 1,
    cents: 88000,
  },
  { guest: "Ioanna Georgiou", from: 34, nights: 3, adults: 2, channel: Channel.direct, room: 0, cents: 31000 },
  { guest: "Mark Johnson", from: 40, nights: 10, adults: 2, channel: Channel.airbnb, room: 2, cents: 120000 },
  { guest: "Sara Lindqvist", from: -20, nights: 5, adults: 2, channel: Channel.booking, room: 3, cents: 50000 },
];

function dayFromToday(offset: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("seed:demo never runs in production");

  await prisma.assignment.deleteMany({ where: { booking: { externalBookingId: { startsWith: PREFIX } } } });
  await prisma.cleaningTask.deleteMany({ where: { booking: { externalBookingId: { startsWith: PREFIX } } } });
  await prisma.booking.deleteMany({ where: { externalBookingId: { startsWith: PREFIX } } });

  const rooms = [];
  for (const [index, room] of ROOMS.entries()) {
    rooms.push(
      await prisma.room.upsert({
        where: { code: room.code },
        update: { ...room, isActive: true, calendarSortIndex: index, rentalIndex: index + 1 },
        create: { ...room, isActive: true, calendarSortIndex: index, rentalIndex: index + 1 },
      }),
    );
  }

  // One listing per platform and apartment, so the money page knows which apartment was booked.
  const listings = new Map<string, string>();
  for (const channel of [Channel.airbnb, Channel.booking]) {
    for (const [index, room] of ROOMS.entries()) {
      const listing = await prisma.sourceListing.upsert({
        where: { channel_externalListingId: { channel, externalListingId: `${room.code}-${channel}` } },
        update: { rentalIndex: index + 1, title: room.displayName },
        create: {
          channel,
          externalListingId: `${room.code}-${channel}`,
          rentalIndex: index + 1,
          title: room.displayName,
        },
      });
      listings.set(`${channel}:${index}`, listing.id);
    }
  }

  // Earlier stays this year, so the money page has a year to show: one every 6 days per apartment,
  // ending before the hand-written bookings above; summer nights cost more.
  const today = dayFromToday(0);
  const daysIntoYear = Math.round((today.getTime() - Date.UTC(today.getUTCFullYear(), 0, 1)) / 86_400_000);
  for (let room = 0; room < ROOMS.length; room += 1) {
    for (let from = -daysIntoYear + room; from <= -26; from += 6) {
      const month = dayFromToday(from).getUTCMonth();
      const nightly = [70, 70, 80, 95, 110, 140, 165, 170, 130, 100, 75, 80][month]! + room * 5;
      const channel = [Channel.airbnb, Channel.booking, Channel.direct][(from + 400) % 3]!;
      BOOKINGS.push({
        guest: `Demo Guest ${room + 1}-${-from}`,
        from,
        nights: 3,
        adults: 2,
        channel,
        room,
        cents: nightly * 3 * 100,
      });
    }
  }

  for (const [index, b] of BOOKINGS.entries()) {
    const checkinDate = dayFromToday(b.from);
    const checkoutDate = dayFromToday(b.from + b.nights);
    const booking = await prisma.booking.create({
      data: {
        channel: b.channel,
        externalBookingId: `${PREFIX}${index}`,
        status: b.status ?? BookingStatus.confirmed,
        checkinDate,
        checkoutDate,
        nights: b.nights,
        guestName: b.guest,
        guestAdults: b.adults,
        guestChildren: b.children ?? 0,
        guestInfants: 0,
        guestTotal: b.adults + (b.children ?? 0),
        totalAmountCents: b.cents ?? null,
        totalValueCents: b.cents ?? null,
        payoutAmountCents: b.cents == null ? null : b.channel === Channel.direct ? b.cents : Math.round(b.cents * 0.85),
        sourceListingId:
          b.channel === Channel.direct ? null : (listings.get(`${b.channel}:${b.room ?? index % 4}`) ?? null),
        currency: "EUR",
      },
    });
    if (b.room !== null) {
      await prisma.assignment.create({
        data: { bookingId: booking.id, roomId: rooms[b.room]!.id, startDate: checkinDate, endDate: checkoutDate },
      });
    }
  }

  await prisma.manualBlock.deleteMany({ where: { reason: "demo: συντήρηση" } });
  await prisma.manualBlock.create({
    data: { roomId: rooms[2]!.id, startDate: dayFromToday(16), endDate: dayFromToday(19), reason: "demo: συντήρηση" },
  });

  console.log(`Demo data: ${ROOMS.length} apartments, ${BOOKINGS.length} bookings.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
