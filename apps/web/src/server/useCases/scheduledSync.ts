import { log } from "@stay-ops/shared";
import { resolveHosthubApiToken } from "@/modules/integrations/hosthubToken";
import { hosthubSource, type HosthubSource } from "@/server/sync/hosthubSource";
import { syncHosthub } from "./syncHosthub";

export type ScheduledSyncResult =
  | { status: "completed"; created: number; updated: number; errors: number }
  | { status: "skipped"; reason: "locked" | "recent" }
  | { status: "no_token" }
  | { status: "failed"; error: string };

/**
 * One background Hosthub sync for the cron routes, so new bookings arrive when nobody has the app open.
 * Never throws: a failure is already recorded in `sync_runs`, and the health check that runs next reports it.
 */
export async function runScheduledSync(source?: HosthubSource): Promise<ScheduledSyncResult> {
  try {
    let src = source;
    if (!src) {
      const token = await resolveHosthubApiToken();
      if (!token) return { status: "no_token" };
      src = hosthubSource(token);
    }
    const result = await syncHosthub({ source: src, trigger: "scheduled" });
    if (result.status === "skipped") return { status: "skipped", reason: result.reason };
    const { created, updated, errors } = result.stats;
    return { status: "completed", created, updated, errors };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log("warn", "scheduled_sync_failed", { error });
    return { status: "failed", error };
  }
}
