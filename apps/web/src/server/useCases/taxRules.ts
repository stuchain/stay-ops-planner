import { writeAuditSnapshot } from "@stay-ops/audit";
import type { Prisma } from "@stay-ops/db";
import type { IncomeBasis, TaxBracket, TaxRules, TaxScope } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { loadTaxRules } from "./buildLedger";

export type SaveTaxRulesInput = {
  year: number;
  brackets: readonly TaxBracket[];
  scope: TaxScope;
  incomeBasis: IncomeBasis;
  confirmed: boolean;
  note: string | null;
  actorUserId: string;
};

/** Replaces a year's tax brackets. The input is already validated (rising limits, last one open). */
export async function saveTaxRules(input: SaveTaxRulesInput): Promise<TaxRules> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.taxRule.findUnique({ where: { year: input.year } });
    const data = {
      brackets: input.brackets as unknown as Prisma.InputJsonValue,
      scope: input.scope,
      incomeBasis: input.incomeBasis,
      confirmed: input.confirmed,
      note: input.note,
    };
    await tx.taxRule.upsert({ where: { year: input.year }, create: { year: input.year, ...data }, update: data });
    const actor = await tx.user.findUnique({ where: { id: input.actorUserId }, select: { id: true } });
    await writeAuditSnapshot(tx, {
      actorUserId: actor?.id ?? null,
      action: "tax_rules.save",
      entityType: "tax_rules",
      entityId: String(input.year),
      before,
      after: data,
    });
    return loadTaxRules(tx, input.year);
  });
}
