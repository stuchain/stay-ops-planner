import { Queue } from "bullmq";
import { bullmqConnectionFromUrl } from "./connection.js";
import { JOB_HOSTHUB_RECONCILE, SYNC_HOSTHUB_QUEUE_NAME } from "./constants.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

/** Stable across deploys for a given NODE_ENV bucket (see phase 3 spec). */
export function hosthubReconcileRepeatJobId(): string {
  const bucket = process.env.NODE_ENV === "production" ? "prod" : process.env.NODE_ENV ?? "dev";
  return `hosthub:reconcile:${bucket}`;
}

/**
 * Registers a repeatable reconcile job (every 15 minutes). Safe to call on each worker boot; same jobId updates repeat options.
 */
export async function registerHosthubReconcileRepeat(redisUrl: string): Promise<void> {
  const connection = bullmqConnectionFromUrl(redisUrl);
  const queue = new Queue(SYNC_HOSTHUB_QUEUE_NAME, { connection });
  try {
    await queue.add(
      JOB_HOSTHUB_RECONCILE,
      {},
      {
        jobId: hosthubReconcileRepeatJobId(),
        repeat: { every: FIFTEEN_MIN_MS },
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
      },
    );
  } finally {
    await queue.close();
  }
}
