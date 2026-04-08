import { BookingStatus, Channel, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const E2E_CLEANUP_LOCK_KEY = 9_209_002;

const E2E_EXTERNAL = [
  "e2e-seed-unassign",
  "e2e-seed-alpha",
  "e2e-seed-bravo",
  "e2e-seed-delta",
];
const E2E_ROOM_CODES = ["E2E-A", "E2E-B", "R1"];

async function cleanupE2eFixtures() {
  const roomIds = (
    await prisma.room.findMany({
      where: { code: { in: E2E_ROOM_CODES } },
      select: { id: true },
    })
  ).map((r) => r.id);

  const [cleaningFromRooms, assignmentsFromRooms, blocksFromRooms] =
    roomIds.length > 0
      ? await Promise.all([
          prisma.cleaningTask.deleteMany({ where: { roomId: { in: roomIds } } }),
          prisma.assignment.deleteMany({ where: { roomId: { in: roomIds } } }),
          prisma.manualBlock.deleteMany({ where: { roomId: { in: roomIds } } }),
        ])
      : [{ count: 0 }, { count: 0 }, { count: 0 }];

  const bookingIds = (
    await prisma.booking.findMany({
      where: {
        channel: Channel.direct,
        externalBookingId: { in: E2E_EXTERNAL },
      },
      select: { id: true },
    })
  ).map((b) => b.id);

  const [cleaningFromBookings, assignmentsFromBookings] =
    bookingIds.length > 0
      ? await Promise.all([
          prisma.cleaningTask.deleteMany({ where: { bookingId: { in: bookingIds } } }),
          prisma.assignment.deleteMany({ where: { bookingId: { in: bookingIds } } }),
        ])
      : [{ count: 0 }, { count: 0 }];

  const seededBookings = await prisma.booking.deleteMany({
    where: {
      channel: Channel.direct,
      externalBookingId: { in: E2E_EXTERNAL },
    },
  });

  const rooms = await prisma.room.deleteMany({
    where: { code: { in: E2E_ROOM_CODES } },
  });

  return {
    cleaned: true,
    deleted: {
      cleaningTasks: cleaningFromRooms.count + cleaningFromBookings.count,
      assignments: assignmentsFromRooms.count + assignmentsFromBookings.count,
      manualBlocks: blocksFromRooms.count,
      bookings: seededBookings.count,
      rooms: rooms.count,
    },
  };
}

async function withAdvisoryLock(fn) {
  await prisma.$executeRaw`SELECT pg_advisory_lock(${E2E_CLEANUP_LOCK_KEY})`;
  try {
    return await fn();
  } finally {
    await prisma.$executeRaw`SELECT pg_advisory_unlock(${E2E_CLEANUP_LOCK_KEY})`;
  }
}

withAdvisoryLock(cleanupE2eFixtures)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error("Failed to cleanup e2e fixtures", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
