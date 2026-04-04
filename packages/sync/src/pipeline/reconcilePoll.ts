import type { Prisma } from "@stay-ops/db";
import { PrismaClient } from "@stay-ops/db";
import { HosthubClient } from "../hosthub/client.js";
import { applyHosthubReservation } from "./applyHosthubReservation.js";

function rowAsJson(row: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;
}

/**
 * Pulls reservation pages from Hosthub and applies the same upsert path as webhooks.
 */
export async function runHosthubReconcile(prisma: PrismaClient): Promise<void> {
  const token = process.env.HOSTHUB_API_TOKEN?.trim();
  if (!token) {
    console.warn("HOSTHUB_API_TOKEN not set; skipping Hosthub reconcile fetch");
    return;
  }

  const baseUrl = process.env.HOSTHUB_API_BASE?.trim() ?? "https://app.hosthub.com/api/2019-03-01";
  const client = new HosthubClient({
    baseUrl,
    apiToken: token,
  });

  let cursor: string | null = null;

  for (;;) {
    const page = await client.listReservationsUpdatedSince({ cursor });
    if (!page.ok) {
      throw new Error(`${page.error.code}: ${page.error.message}`);
    }

    for (const row of page.value.data) {
      await applyHosthubReservation(prisma, row, rowAsJson(row));
    }

    const next = page.value.nextCursor;
    if (!next) {
      break;
    }
    cursor = next;
  }
}
