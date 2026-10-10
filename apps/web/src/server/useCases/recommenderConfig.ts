import { z } from "zod";
import { writeAuditSnapshot } from "@stay-ops/audit";
import { DEFAULT_RECOMMENDER_CONFIG, DomainError, RULE_NAMES, type RecommenderConfig } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { readSetting } from "./settings";

export const RECOMMENDER_SETTING_KEY = "recommender.rules";

/**
 * Every rule exactly once, in the order they are applied. Unknown rule names are refused,
 * and so is a weight that is not a whole number from -100 to 100.
 */
export const recommenderConfigSchema = z
  .object({
    rules: z
      .array(
        z
          .object({
            rule: z.enum(RULE_NAMES),
            weight: z.number().int().min(-100).max(100),
          })
          .strict(),
      )
      .length(RULE_NAMES.length),
  })
  .strict()
  .refine((config) => new Set(config.rules.map((r) => r.rule)).size === RULE_NAMES.length, {
    message: "every rule exactly once",
  });

/** The saved rules, or today's behaviour when nothing valid is saved. */
export async function loadRecommenderConfig(): Promise<RecommenderConfig> {
  const stored = await readSetting(RECOMMENDER_SETTING_KEY);
  if (stored === null) return DEFAULT_RECOMMENDER_CONFIG;
  const parsed = recommenderConfigSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_RECOMMENDER_CONFIG;
}

export async function saveRecommenderConfig(input: {
  config: unknown;
  actorUserId: string;
}): Promise<RecommenderConfig> {
  const parsed = recommenderConfigSchema.safeParse(input.config);
  if (!parsed.success) throw new DomainError("VALIDATION");
  const before = await loadRecommenderConfig();
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({
      where: { key: RECOMMENDER_SETTING_KEY },
      create: { key: RECOMMENDER_SETTING_KEY, value: parsed.data },
      update: { value: parsed.data },
    });
    await writeAuditSnapshot(tx, {
      actorUserId: input.actorUserId,
      entityType: "setting",
      entityId: RECOMMENDER_SETTING_KEY,
      action: "setting.update",
      before,
      after: parsed.data,
    });
  });
  return parsed.data;
}

/** "Επαναφορά προεπιλογών": forget the saved rules so today's behaviour applies. */
export async function resetRecommenderConfig(actorUserId: string): Promise<RecommenderConfig> {
  const before = await loadRecommenderConfig();
  await prisma.$transaction(async (tx) => {
    await tx.setting.deleteMany({ where: { key: RECOMMENDER_SETTING_KEY } });
    await writeAuditSnapshot(tx, {
      actorUserId,
      entityType: "setting",
      entityId: RECOMMENDER_SETTING_KEY,
      action: "setting.reset",
      before,
      after: DEFAULT_RECOMMENDER_CONFIG,
    });
  });
  return DEFAULT_RECOMMENDER_CONFIG;
}
