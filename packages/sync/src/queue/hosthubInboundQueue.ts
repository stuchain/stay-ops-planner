import { Queue } from "bullmq";
import { JOB_HOSTHUB_INBOUND, SYNC_HOSTHUB_QUEUE_NAME } from "./constants.js";

export type HosthubInboundJobPayload = {
  dedupeKey: string;
  rawBody: string;
};

/** BullMQ passes options through to ioredis; avoid direct `new Redis()` (CJS/ESM default export typing). */
function bullmqConnectionFromUrl(redisUrl: string) {
  const u = new URL(redisUrl);
  const port = u.port ? Number(u.port) : 6379;
  return {
    host: u.hostname,
    port,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    maxRetriesPerRequest: null,
  };
}

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
