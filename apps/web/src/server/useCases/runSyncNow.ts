import { DomainError } from "@stay-ops/domain";
import { resolveHosthubApiToken } from "@/modules/integrations/hosthubToken";
import { hosthubSource, type HosthubSource } from "@/server/sync/hosthubSource";
import { classifySyncError, type SyncProblem } from "./syncStatus";
import { syncHosthub } from "./syncHosthub";

export type RunSyncNowResult =
  | { outcome: "done"; changed: number; created: number; updated: number; unchanged: number; errors: number }
  | { outcome: "failed"; problem: Exclude<SyncProblem, "none"> };

/**
 * The "Ενημέρωση τώρα" button: one manual sync, answered in a few plain outcomes.
 * Throws HOSTHUB_DISCONNECTED when no Hosthub key is stored and SYNC_RUNNING when one is already under way.
 */
export async function runSyncNow(source?: HosthubSource): Promise<RunSyncNowResult> {
  let src = source;
  if (!src) {
    const token = await resolveHosthubApiToken();
    if (!token) throw new DomainError("HOSTHUB_DISCONNECTED");
    src = hosthubSource(token);
  }
  try {
    const result = await syncHosthub({ source: src, trigger: "manual" });
    if (result.status === "skipped") throw new DomainError("SYNC_RUNNING");
    const { created, updated, unchanged, errors } = result.stats;
    return { outcome: "done", changed: created + updated, created, updated, unchanged, errors };
  } catch (e) {
    if (e instanceof DomainError) throw e;
    const problem = classifySyncError(e instanceof Error ? e.message : String(e));
    return { outcome: "failed", problem: problem === "none" ? "other" : problem };
  }
}
