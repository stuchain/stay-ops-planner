import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import type { Prisma } from "@stay-ops/db";
import { getSyncPrisma } from "../db/client.js";
import { JOB_HOSTHUB_INBOUND, JOB_HOSTHUB_RECONCILE } from "../queue/constants.js";
import type { HosthubInboundJobPayload } from "../queue/hosthubInboundQueue.js";
import { parseHosthubWebhookJson } from "../webhook/dedupeKey.js";
import { extractHosthubReservationDto } from "../pipeline/extractReservation.js";
import { applyHosthubReservation } from "../pipeline/applyHosthubReservation.js";
import { runHosthubReconcile } from "../pipeline/reconcilePoll.js";
import { finalizeSyncRun, recordImportError, startSyncRun } from "../pipeline/syncRunService.js";
import { HosthubClient } from "../hosthub/client.js";

/**
 * Dispatches BullMQ jobs on `sync-hosthub`.
 */
export async function processSyncHosthubJob(job: Job): Promise<void> {
  const prisma = getSyncPrisma();

  if (job.name === JOB_HOSTHUB_INBOUND) {
    const data = job.data as HosthubInboundJobPayload;
    try {
      const parsed = parseHosthubWebhookJson(data.rawBody);
      if (!parsed.ok) {
        throw new Error("Inbound job: invalid JSON body");
      }
      const dto = extractHosthubReservationDto(parsed.value);
      if (!dto) {
        throw new Error("Inbound job: could not extract reservation from payload");
      }
      const token = process.env.HOSTHUB_API_TOKEN?.trim();
      let hosthubNotesRaw: Prisma.InputJsonValue | null | undefined;
      let hosthubGrTaxesRaw: Prisma.InputJsonValue | null | undefined;
      if (token) {
        const baseUrl = process.env.HOSTHUB_API_BASE?.trim() ?? "https://app.hosthub.com/api/2019-03-01";
        const client = new HosthubClient({ baseUrl, apiToken: token });
        try {
          const notesRes = await client.getCalendarEventNotes(dto.reservationId);
          const grTaxesRes = await client.getCalendarEventGrTaxes(dto.reservationId);
          hosthubNotesRaw = notesRes.ok
            ? (JSON.parse(JSON.stringify(notesRes.value)) as Prisma.InputJsonValue)
            : null;
          hosthubGrTaxesRaw = grTaxesRes.ok
            ? (JSON.parse(JSON.stringify(grTaxesRes.value)) as Prisma.InputJsonValue)
            : null;
        } catch {
          hosthubNotesRaw = null;
          hosthubGrTaxesRaw = null;
        }
      }

      await applyHosthubReservation(prisma, dto, parsed.value as Prisma.InputJsonValue, {
        hosthubNotesRaw,
        hosthubGrTaxesRaw,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isPayloadError = /invalid JSON body|could not extract reservation/i.test(msg);
      if (!isPayloadError) {
        throw e;
      }
      const run = await startSyncRun(prisma, "hosthub_webhook");
      await recordImportError(prisma, run.id, "MISSING_REQUIRED_FIELD", msg, {
        dedupeKey: data.dedupeKey,
      });
      await finalizeSyncRun(prisma, run.id, "failed", { fetched: 0, upserted: 0, errors: 1, skipped: 0 }, null);
      throw new UnrecoverableError(msg);
    }
    return;
  }

  if (job.name === JOB_HOSTHUB_RECONCILE) {
    await runHosthubReconcile(prisma);
    return;
  }

  throw new Error(`Unknown sync-hosthub job name: ${job.name}`);
}
