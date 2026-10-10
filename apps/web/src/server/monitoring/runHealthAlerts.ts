import type { PrismaClient } from "@stay-ops/db";
import { log } from "@stay-ops/shared";
import { evaluateSyncHealth, type SyncProblem } from "./syncHealth";
import { deliver, type Notifier } from "./notifier";

export type HealthAlertResult = {
  problems: string[];
  alerted: string[];
  recovered: string[];
  delivery: "sent" | "failed" | "unconfigured" | "none";
};

/**
 * Checks sync health and tells Stelios once per problem. An open problem is remembered in
 * `alert_states`; it is only recorded after a message really went out, so a failed or
 * unconfigured delivery is retried on the next run.
 */
export async function runHealthAlerts(opts: {
  db: Pick<PrismaClient, "syncState" | "syncRun" | "alertState">;
  notifiers: Notifier[];
  now?: Date;
}): Promise<HealthAlertResult> {
  const { db, notifiers } = opts;
  const now = opts.now ?? new Date();

  const [state, recentRuns] = await Promise.all([
    db.syncState.findUnique({ where: { id: 1 } }),
    db.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 5, select: { startedAt: true, status: true } }),
  ]);
  const problems = evaluateSyncHealth({ now, lastSuccessAt: state?.lastSuccessAt ?? null, recentRuns });
  const open = await db.alertState.findMany();
  const openKeys = new Set(open.map((o) => o.key));

  const fresh: SyncProblem[] = problems.filter((p) => !openKeys.has(p.key));
  const currentKeys = new Set<string>(problems.map((p) => p.key));
  const cleared = open.filter((o) => !currentKeys.has(o.key));

  const result: HealthAlertResult = {
    problems: problems.map((p) => p.key),
    alerted: [],
    recovered: [],
    delivery: "none",
  };

  if (fresh.length > 0) {
    const lastError = state?.lastError ? `\nLast error: ${state.lastError}` : "";
    const delivery = await deliver(notifiers, {
      subject: "Stay Ops: Hosthub sync needs attention",
      body: `${fresh.map((p) => p.detail).join("\n")}${lastError}\n\nSee docs/runbooks/runbook-sync-failure.md.`,
    });
    result.delivery = delivery;
    if (delivery === "sent") {
      for (const p of fresh) {
        await db.alertState.upsert({
          where: { key: p.key },
          create: { key: p.key, detail: p.detail, alertedAt: now },
          update: { detail: p.detail, alertedAt: now },
        });
        result.alerted.push(p.key);
      }
    }
  }

  if (cleared.length > 0) {
    const delivery = await deliver(notifiers, {
      subject: "Stay Ops: Hosthub sync is working again",
      body: cleared.map((c) => `Resolved: ${c.detail ?? c.key}`).join("\n"),
    });
    if (result.delivery === "none") result.delivery = delivery;
    // Close the problem even if the "all clear" message failed: it is only a courtesy.
    await db.alertState.deleteMany({ where: { key: { in: cleared.map((c) => c.key) } } });
    result.recovered.push(...cleared.map((c) => c.key));
  }

  log("info", "health_alerts_checked", { ...result });
  return result;
}
