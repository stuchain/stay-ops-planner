import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Queue } from "bullmq";
import { bullmqConnectionFromUrl, SYNC_HOSTHUB_QUEUE_NAME } from "@stay-ops/sync";
import { respondAuthError } from "@/lib/apiError";
import { AuthError } from "@/modules/auth/errors";
import { requireAdminSession } from "@/modules/auth/guard";

const MAX_FAILED = 20;

/**
 * BullMQ queue health for `sync-hosthub` (admin-only). Does not return raw job payloads.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdminSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }

  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    return NextResponse.json(
      { error: { code: "SERVICE_UNAVAILABLE", message: "REDIS_URL is not configured" } },
      { status: 503 },
    );
  }

  const connection = bullmqConnectionFromUrl(redisUrl);
  const queue = new Queue(SYNC_HOSTHUB_QUEUE_NAME, { connection });
  try {
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "paused", "completed");
    const failedJobs = await queue.getFailed(0, MAX_FAILED - 1);
    const failed = failedJobs.map((j) => ({
      id: j.id,
      name: j.name,
      failedReason: j.failedReason ?? null,
      attemptsMade: j.attemptsMade,
      timestamp: j.timestamp,
      finishedOn: j.finishedOn ?? null,
    }));

    return NextResponse.json(
      {
        data: {
          queueName: SYNC_HOSTHUB_QUEUE_NAME,
          counts,
          failed,
        },
      },
      { status: 200 },
    );
  } finally {
    await queue.close();
  }
}
