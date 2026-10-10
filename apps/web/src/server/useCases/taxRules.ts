import { writeAuditSnapshot } from "@stay-ops/audit";
import type { Prisma } from "@stay-ops/db";
import type { IncomeBasis, TaxBracket, TaxRules, TaxScope } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { todayIso } from "@/server/time";
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

export type TaxRulesForEditing = {
  rules: TaxRules;
  note: string | null;
  /** False while the year still uses the built-in brackets (nothing saved for it). */
  saved: boolean;
  updatedAt: Date | null;
  /** Years with saved brackets, plus last, this and next year. */
  years: number[];
};

/** One year's brackets for the Dev mode editor, with the years worth offering. */
export async function taxRulesForEditing(year: number, now: Date = new Date()): Promise<TaxRulesForEditing> {
  const current = Number(todayIso(now).slice(0, 4));
  const [rules, row, saved] = await Promise.all([
    loadTaxRules(prisma, year),
    prisma.taxRule.findUnique({ where: { year }, select: { note: true, updatedAt: true } }),
    prisma.taxRule.findMany({ select: { year: true } }),
  ]);
  const years = new Set([current - 1, current, current + 1, year, ...saved.map((r) => r.year)]);
  return {
    rules,
    note: row?.note ?? null,
    saved: row !== null,
    updatedAt: row?.updatedAt ?? null,
    years: [...years].sort((a, b) => a - b),
  };
}
