import type { Prisma } from "@stay-ops/db";
import { prisma } from "@/lib/prisma";

/** Generic key/value settings (table `settings`). Callers validate what they read and write. */
export async function readSetting(key: string): Promise<unknown | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row ? row.value : null;
}

export async function writeSetting(key: string, value: Prisma.InputJsonValue): Promise<void> {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function deleteSetting(key: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key } });
}
