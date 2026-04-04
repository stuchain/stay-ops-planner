import type { Job } from "bullmq";
import { JOB_HOSTHUB_INBOUND, JOB_HOSTHUB_RECONCILE } from "../queue/constants.js";
import type { HosthubInboundJobPayload } from "../queue/hosthubInboundQueue.js";

/**
 * Dispatches BullMQ jobs on `sync-hosthub`. Inbound/reconcile bodies are implemented in later commits.
 */
export async function processSyncHosthubJob(job: Job): Promise<void> {
  if (job.name === JOB_HOSTHUB_INBOUND) {
    const data = job.data as HosthubInboundJobPayload;
    if (process.env.LOG_LEVEL === "debug") {
      console.debug("sync hosthub inbound", { dedupeKey: data.dedupeKey });
    } else {
      console.info("sync hosthub inbound", data.dedupeKey);
    }
    return;
  }
  if (job.name === JOB_HOSTHUB_RECONCILE) {
    console.info("sync hosthub reconcile tick");
    return;
  }
  throw new Error(`Unknown sync-hosthub job name: ${job.name}`);
}
