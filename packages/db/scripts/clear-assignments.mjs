import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.assignment.count();
  const result = await prisma.assignment.deleteMany({});
  const after = await prisma.assignment.count();
  console.log(
    JSON.stringify(
      {
        clearedAssignments: result.count,
        before,
        after,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error("Failed to clear assignments", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
