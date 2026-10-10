import type { PrismaClient, Prisma } from "@stay-ops/db";

/** `bookingId` and `roomId` are required; dates are `Date` (use `createPlacedBooking` for the common case). */
export type AssignmentInput = Prisma.AssignmentUncheckedCreateInput;

export async function createAssignment(prisma: PrismaClient, input: AssignmentInput) {
  return prisma.assignment.create({ data: input });
}
