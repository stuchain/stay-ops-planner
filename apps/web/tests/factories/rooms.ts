import type { PrismaClient, Prisma } from "@stay-ops/db";
import { uniqueSuffix } from "./ids";

export type RoomOverrides = Partial<Prisma.RoomUncheckedCreateInput>;

export async function createRoom(prisma: PrismaClient, overrides: RoomOverrides = {}) {
  const suffix = uniqueSuffix();
  return prisma.room.create({
    data: {
      code: `R-${suffix}`,
      displayName: `Test room ${suffix}`,
      isActive: true,
      maxGuests: 4,
      ...overrides,
    },
  });
}
