import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  await prisma.$connect();
  const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  // Local-only bootstrap: Phase 1 admins can be provisioned via env vars.
  if (!bootstrapEmail || !bootstrapPassword) {
    console.log("seed: connected (no bootstrap admin env provided)");
    return;
  }

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bootstrapEmail);
  if (!emailOk) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL must be a valid email address");
  }

  if (bootstrapPassword.length < 8) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters");
  }

  const costRaw =
    process.env.BCRYPT_COST ?? process.env.BCRYPT_WORK_FACTOR ?? process.env.BCRYPT_ROUNDS;
  const cost = costRaw ? Number(costRaw) : 12;

  if (!Number.isFinite(cost) || cost < 4 || cost > 31) {
    throw new Error("BCRYPT_COST must be a number in a safe range (4-31)");
  }

  const passwordHash = await bcrypt.hash(bootstrapPassword, cost);

  await prisma.user.upsert({
    where: { email: bootstrapEmail },
    update: { passwordHash, isActive: true },
    create: {
      email: bootstrapEmail,
      passwordHash,
      isActive: true,
    },
  });

  console.log("seed: bootstrap admin upserted");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
