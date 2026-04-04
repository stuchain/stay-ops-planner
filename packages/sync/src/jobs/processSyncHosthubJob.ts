import type { Job } from "bullmq";
import type { Prisma } from "@stay-ops/db";
import { getSyncPrisma } from "../db/client.js";
import { JOB_HOSTHUB_INBOUND, JOB_HOSTHUB_RECONCILE } from "../queue/constants.js";
import type { HosthubInboundJobPayload } from "../queue/hosthubInboundQueue.js";
import { parseHosthubWebhookJson } from "../webhook/dedupeKey.js";
import { extractHosthubReservationDto } from "../pipeline/extractReservation.js";
import { applyHosthubReservation } from "../pipeline/applyHosthubReservation.js";
import { runHosthubReconcile } from "../pipeline/reconcilePoll.js";

/**
 * Dispatches BullMQ jobs on `sync-hosthub`.
 */
export async function processSyncHosthubJob(job: Job): Promise<void> {
  const prisma = getSyncPrisma();

  if (job.name === JOB_HOSTHUB_INBOUND) {
    const data = job.data as HosthubInboundJobPayload;
    const parsed = parseHosthubWebhookJson(data.rawBody);
    if (!parsed.ok) {
      throw new Error("Inbound job: invalid JSON body");
    }
    const dto = extractHosthubReservationDto(parsed.value);
    if (!dto) {
      throw new Error("Inbound job: could not extract reservation from payload");
    }
    await applyHosthubReservation(prisma, dto, parsed.value as Prisma.InputJsonValue);
    return;
  }

  if (job.name === JOB_HOSTHUB_RECONCILE) {
    await runHosthubReconcile(prisma);
    return;
  }

  throw new Error(`Unknown sync-hosthub job name: ${job.name}`);
}
