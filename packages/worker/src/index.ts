import { parseEnv } from "@stay-ops/shared";
import {
  bullmqConnectionFromUrl,
  disconnectSyncPrisma,
  processSyncHosthubJob,
  registerHosthubReconcileRepeat,
  SYNC_HOSTHUB_QUEUE_NAME,
} from "@stay-ops/sync";
import { Worker } from "bullmq";
import { loadHosthubLocalEnv } from "./loadHosthubLocalEnv.js";
import { initWorkerSentry, Sentry } from "./sentry.js";

loadHosthubLocalEnv();
parseEnv(process.env);
initWorkerSentry();

const redisUrlRaw = process.env.REDIS_URL?.trim();
if (!redisUrlRaw) {
  console.error("REDIS_URL is required for the sync worker");
  process.exit(1);
}
const redisUrl = redisUrlRaw;

async function main() {
  await registerHosthubReconcileRepeat(redisUrl);

  const worker = new Worker(SYNC_HOSTHUB_QUEUE_NAME, processSyncHosthubJob, {
    connection: bullmqConnectionFromUrl(redisUrl),
    concurrency: 1,
  });

  worker.on("failed", (job, err) => {
    console.error("sync job failed", job?.name, job?.id, err);
    let dataPreview = "";
    let payloadBytes = 0;
    try {
      const raw = JSON.stringify(job?.data ?? null);
      payloadBytes = Buffer.byteLength(raw, "utf8");
      dataPreview = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
    } catch {
      dataPreview = "(unserializable job.data)";
    }
    void Sentry.captureException(err, {
      tags: { queue: SYNC_HOSTHUB_QUEUE_NAME, job: job?.name ?? "unknown" },
      extra: {
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        maxAttempts: job?.opts?.attempts,
        failedReason: job?.failedReason,
        timestamp: job?.timestamp,
        finishedOn: job?.finishedOn,
        payloadBytes,
        dataPreview,
      },
    });
  });

  console.info("stay-ops worker: listening on queue", SYNC_HOSTHUB_QUEUE_NAME);

  const shutdown = async (signal: string) => {
    console.info("stay-ops worker: shutdown", signal);
    await worker.close();
    await disconnectSyncPrisma();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
