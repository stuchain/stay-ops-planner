import { parseEnv } from "@stay-ops/shared";
import {
  bullmqConnectionFromUrl,
  processSyncHosthubJob,
  registerHosthubReconcileRepeat,
  SYNC_HOSTHUB_QUEUE_NAME,
} from "@stay-ops/sync";
import { Worker } from "bullmq";

parseEnv(process.env);

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
  });

  console.info("stay-ops worker: listening on queue", SYNC_HOSTHUB_QUEUE_NAME);

  const shutdown = async (signal: string) => {
    console.info("stay-ops worker: shutdown", signal);
    await worker.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
