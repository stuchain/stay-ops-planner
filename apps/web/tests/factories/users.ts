import bcrypt from "bcryptjs";
import type { PrismaClient, Prisma } from "@stay-ops/db";
import { uniqueSuffix } from "./ids";

export const DEFAULT_TEST_PASSWORD = "password1234";

export type UserOverrides = Partial<Omit<Prisma.UserUncheckedCreateInput, "passwordHash">> & {
  /** Plain password; hashed with a low bcrypt cost. Defaults to {@link DEFAULT_TEST_PASSWORD}. */
  password?: string;
};

export async function createUser(prisma: PrismaClient, overrides: UserOverrides = {}) {
  const { password = DEFAULT_TEST_PASSWORD, ...rest } = overrides;
  return prisma.user.create({
    data: {
      email: `user-${uniqueSuffix()}@example.test`,
      role: "operator",
      isActive: true,
      ...rest,
      passwordHash: await bcrypt.hash(password, 4),
    },
  });
}
