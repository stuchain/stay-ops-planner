import "./load-env.js";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function resolveCost(): number {
  const costRaw =
    process.env.BCRYPT_COST ?? process.env.BCRYPT_WORK_FACTOR ?? process.env.BCRYPT_ROUNDS;
  const cost = costRaw ? Number(costRaw) : 12;

  if (!Number.isFinite(cost) || cost < 4 || cost > 31) {
    throw new Error("BCRYPT_COST must be a number in a safe range (4-31)");
  }

  return cost;
}

async function upsertAdmin(email: string, passwordPlain: string, cost: number): Promise<void> {
  const passwordHash = await bcrypt.hash(passwordPlain, cost);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, isActive: true },
    create: {
      email,
      passwordHash,
      isActive: true,
    },
  });
}

async function main() {
  await prisma.$connect();
  const cost = resolveCost();

  const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (bootstrapEmail && bootstrapPassword) {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bootstrapEmail);
    if (!emailOk) {
      throw new Error("BOOTSTRAP_ADMIN_EMAIL must be a valid email address");
    }

    if (bootstrapPassword.length < 8) {
      throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters");
    }

    await upsertAdmin(bootstrapEmail, bootstrapPassword, cost);
    console.log("seed: bootstrap admin upserted");
  } else {
    console.log("seed: skipped BOOTSTRAP_ADMIN_* (not set)");
  }

  // Insecure local-only account (explicit opt-in). User model has no display name; login is email + password.
  if (process.env.STAYOPS_DEV_ADMIN === "1") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("STAYOPS_DEV_ADMIN must not be enabled when NODE_ENV is production");
    }
    const email = "admin@stayops.local";
    const password = "admin";
    await upsertAdmin(email, password, cost);
    console.log(`seed: dev admin upserted (${email} / ${password})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
