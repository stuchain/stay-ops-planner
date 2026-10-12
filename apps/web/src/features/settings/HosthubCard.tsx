import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { useAgoText } from "@/features/shell/SyncIndicator";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Skeleton } from "@/ui/Skeleton";

/** Hosthub status in words, and "Ενημέρωση τώρα" for those who manage bookings. */
export function HosthubCard({ canRefresh }: { canRefresh: boolean }) {
  const t = useTranslations("settingsScreen.hosthub");
  const errorText = useErrorText();
  const agoText = useAgoText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const status = useQuery({ ...trpc.sync.status.queryOptions(), refetchInterval: 15_000 });
  const run = useMutation(
    trpc.sync.run.mutationOptions({
      meta: { handlesErrors: true },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.sync.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.calendar.pathKey() });
      },
    }),
  );

  const running = run.isPending || status.data?.running === true;
  const problem = status.data?.problem ?? "none";

  let headline: string | null = null;
  if (status.data) {
    headline = running
      ? t("running")
      : problem === "auth"
        ? t("authProblem")
        : problem === "other"
          ? t("otherProblem")
          : t("okState");
  }

  let result: { tone: "ok" | "bad"; text: string[] } | null = null;
  if (run.error) result = { tone: "bad", text: [errorText(run.error)] };
  else if (run.data?.outcome === "failed")
    result = { tone: "bad", text: [run.data.problem === "auth" ? t("failedAuth") : t("failedOther")] };
  else if (run.data?.outcome === "done") {
    const lines = [run.data.changed > 0 ? t("doneChanged", { count: run.data.changed }) : t("doneNone")];
    if (run.data.errors > 0) lines.push(t("doneErrors", { count: run.data.errors }));
    result = { tone: run.data.errors > 0 ? "bad" : "ok", text: lines };
  }

  return (
    <Card title={t("title")}>
      {!status.data ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="flex flex-col gap-1" aria-live="polite">
          <p className="flex items-start gap-2 text-base font-medium">
            {problem !== "none" && !running ? (
              <TriangleAlert size={24} className="text-warning shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle2 size={24} className="text-success shrink-0" aria-hidden="true" />
            )}
            <span>{headline}</span>
          </p>
          <p className="text-text-muted text-base">
            {status.data.lastSuccessAt ? t("lastSuccess", { ago: agoText(status.data.lastSuccessAt) }) : t("never")}
          </p>
        </div>
      )}
      {canRefresh ? (
        <div>
          <Button
            variant="primary"
            size="lg"
            icon={RefreshCw}
            loading={running}
            loadingLabel={t("refreshing")}
            onClick={() => run.mutate()}
          >
            {t("refresh")}
          </Button>
        </div>
      ) : (
        <p className="text-text-muted text-base">{t("viewerNote")}</p>
      )}
      {result ? (
        <div
          role="status"
          className={
            result.tone === "ok"
              ? "bg-success-soft text-success-text rounded-sm p-4 text-base"
              : "bg-warning-soft text-warning-text rounded-sm p-4 text-base"
          }
        >
          {result.text.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
