import { Queue } from "bullmq";
import { log, withRetry } from "@stay-ops/shared";
import { JOB_HOSTHUB_INBOUND, SYNC_HOSTHUB_QUEUE_NAME } from "./constants.js";
import { bullmqConnectionFromUrl } from "./connection.js";
import { isTransientRedisOrNetworkError } from "../retry/isTransient.js";

export type HosthubInboundJobPayload = {
  dedupeKey: string;
  rawBody: string;
};

const queueByRedisUrl = new Map<string, Queue<HosthubInboundJobPayload>>();

function getOrCreateQueue(redisUrl: string): Queue<HosthubInboundJobPayload> {
  let q = queueByRedisUrl.get(redisUrl);
  if (!q) {
    q = new Queue<HosthubInboundJobPayload>(SYNC_HOSTHUB_QUEUE_NAME, {
      connection: bullmqConnectionFromUrl(redisUrl),
    });
    queueByRedisUrl.set(redisUrl, q);
  }
  return q;
}

/**
 * Enqueues webhook body for async processing. DB `webhook_inbound_events` enforces at-most-once accept per dedupeKey.
 */
export async function enqueueHosthubInbound(
  redisUrl: string,
  payload: HosthubInboundJobPayload,
): Promise<void> {
  const queue = getOrCreateQueue(redisUrl);
  await withRetry(
    () =>
      queue.add(JOB_HOSTHUB_INBOUND, payload, {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      }),
    {
      maxAttempts: 3,
      isTransient: isTransientRedisOrNetworkError,
      onRetry: ({ attempt, delayMs, err }) => {
        log("warn", "retry_attempt", {
          op: "enqueueHosthubInbound",
          attempt,
          delayMs,
          errMessage: err instanceof Error ? err.message : String(err),
        });
      },
      onExhausted: ({ attempts, elapsedMs, cause }) => {
        log("error", "retry_exhausted", {
          op: "enqueueHosthubInbound",
          attempts,
          elapsedMs,
          errMessage: cause instanceof Error ? cause.message : String(cause),
        });
      },
    },
  );
}
