import type { PrismaClient } from "@stay-ops/db";

export type RentalLabels = {
  label1: string;
  label2: string;
  label3: string;
  label4: string;
};

const DEFAULT_LABELS: RentalLabels = {
  label1: "Onar",
  label2: "Cosmos",
  label3: "Iris",
  label4: "Helios",
};

/** Ensures singleton row id=1 exists and returns the four column labels. */
export async function getOrCreateExcelRentalConfig(prisma: PrismaClient): Promise<RentalLabels> {
  const existing = await prisma.excelRentalConfig.findUnique({ where: { id: 1 } });
  if (existing) {
    return {
      label1: existing.label1,
      label2: existing.label2,
      label3: existing.label3,
      label4: existing.label4,
    };
  }
  const created = await prisma.excelRentalConfig.create({
    data: { id: 1 },
  });
  return {
    label1: created.label1,
    label2: created.label2,
    label3: created.label3,
    label4: created.label4,
  };
}

export function defaultRentalLabels(): RentalLabels {
  return { ...DEFAULT_LABELS };
}
