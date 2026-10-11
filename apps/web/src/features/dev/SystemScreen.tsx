"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ErrorState } from "@/ui/ErrorState";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { showToast } from "@/ui/Toast";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border flex flex-wrap items-baseline justify-between gap-2 border-b py-3 last:border-b-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function SystemCard() {
  const t = useTranslations("dev.system");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const info = useQuery(trpc.dev.system.info.queryOptions());
  if (info.isPending) return <Skeleton variant="block" className="h-48" />;
  if (info.error) return <ErrorState message={errorText(info.error)} onRetry={() => void info.refetch()} />;
  const { version, commit, database, sentryUrl } = info.data;
  return (
    <Card title={t("systemTitle")}>
      <dl>
        <Row label={t("version")}>{version}</Row>
        <Row label={t("commit")}>
          {commit ? <span className="font-mono">{commit.slice(0, 7)}</span> : t("localBuild")}
        </Row>
        <Row label={t("database")}>
          {database.ok ? (
            <span className="text-success-text">{t("databaseOk", { ms: database.pingMs })}</span>
          ) : (
            <span className="text-danger">{t("databaseDown")}</span>
          )}
        </Row>
        {database.ok ? <Row label={t("migrations")}>{database.migrations}</Row> : null}
        <Row label={t("sentry")}>
          {sentryUrl ? (
            <a
              href={sentryUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent inline-flex min-h-target items-center gap-2 underline"
            >
              {t("sentryOpen")}
              <ExternalLink size={18} aria-hidden="true" />
            </a>
          ) : (
            t("sentryNone")
          )}
        </Row>
      </dl>
    </Card>
  );
}

function ReminderCard() {
  const t = useTranslations("dev.system.reminder");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const reminder = useQuery(trpc.dev.system.reminder.queryOptions());
  const toggle = useMutation({
    ...trpc.dev.system.setReminder.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: trpc.dev.system.reminder.queryKey() });
      showToast({ message: t("saved"), tone: "success" });
    },
    onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
  });
  const test = useMutation({
    ...trpc.dev.system.testReminder.mutationOptions(),
    onSuccess: ({ status }) =>
      showToast(
        status === "sent"
          ? { message: t("testSent"), tone: "success" }
          : { message: status === "unconfigured" ? t("notConfigured") : t("testFailed"), tone: "danger" },
      ),
    onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
  });

  return (
    <Card title={t("title")}>
      <p className="text-text-muted">{t("text")}</p>
      {reminder.isPending ? (
        <Skeleton variant="block" className="h-24" />
      ) : reminder.error ? (
        <ErrorState message={errorText(reminder.error)} onRetry={() => void reminder.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <label className="min-h-target flex items-center gap-3">
            <input
              type="checkbox"
              className="size-6"
              checked={reminder.data.enabled}
              disabled={toggle.isPending}
              onChange={(e) => toggle.mutate({ enabled: e.target.checked })}
            />
            <span>{t("enabled")}</span>
          </label>
          {reminder.data.configured ? null : (
            <p role="status" className="bg-warning-soft text-warning-text rounded-card p-3 font-medium">
              {t("notConfigured")}
            </p>
          )}
          <Button className="self-start" loading={test.isPending} onClick={() => test.mutate()}>
            {t("sendTest")}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Dev mode: app version, database status, the Sentry link and the daily reminder. */
export function SystemScreen() {
  const t = useTranslations("dev.system");
  return (
    <div className="flex flex-col gap-6 p-8 max-[759px]:p-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <SystemCard />
        <ReminderCard />
      </div>
    </div>
  );
}
