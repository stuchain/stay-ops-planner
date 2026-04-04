import { Queue } from "bullmq";
import { JOB_HOSTHUB_INBOUND, SYNC_HOSTHUB_QUEUE_NAME } from "./constants.js";
import { bullmqConnectionFromUrl } from "./connection.js";

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
  await queue.add(JOB_HOSTHUB_INBOUND, payload, {
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  });
}
