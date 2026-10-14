"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Copy, RefreshCw, RotateCcw, Save } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { ImportErrorRow, SyncRunRow } from "@/api/types";
import { fieldClass } from "@/ui/field";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { showToast } from "@/ui/Toast";
import { cn } from "@/ui/cn";

type Confirm = "full" | "reset" | null;

function useWhen() {
  const format = useFormatter();
  return (iso: string | null | undefined): string | null =>
    iso
      ? format.dateTime(new Date(iso), {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
}

/** The Hosthub key: when it was saved, and a box to test and save a new one. Also on Settings for admins. */
export function HosthubTokenCard() {
  const t = useTranslations("dev.hosthub");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const when = useWhen();
  const overview = useQuery(trpc.dev.hosthub.overview.queryOptions());
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    ...trpc.dev.hosthub.saveToken.mutationOptions(),
    onSuccess: () => {
      setToken("");
      setProblem(null);
      void queryClient.invalidateQueries({ queryKey: trpc.dev.hosthub.overview.queryKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.sync.status.queryKey() });
      showToast({ message: t("token.saved"), tone: "success" });
    },
    onError: (error) => setProblem(errorText(error)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    save.mutate({ token, name: name.trim() === "" ? null : name });
  }

  const status = overview.data?.token;
  return (
    <Card title={t("token.title")}>
      {overview.isPending ? (
        <Skeleton variant="block" className="h-24" />
      ) : (
        <>
          <p>
            {status?.configured ? t("token.configured", { when: when(status.updatedAt) ?? "" }) : t("token.missing")}
            {status?.name ? <span className="text-text-muted"> {t("token.named", { name: status.name })}</span> : null}
          </p>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="font-medium">{t("token.newToken")}</span>
              <input
                className={`${fieldClass} w-full`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                aria-invalid={problem !== null}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="font-medium">{t("token.name")}</span>
              <input
                className={`${fieldClass} w-full`}
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {problem ? (
              <p role="alert" className="bg-danger-soft text-danger rounded-card p-3 font-medium">
                {problem}
              </p>
            ) : null}
            <div>
              <Button
                type="submit"
                variant="secondary"
                size="lg"
                icon={Save}
                loading={save.isPending}
                loadingLabel={t("token.testing")}
                disabled={token.trim() === ""}
              >
                {t("token.save")}
              </Button>
            </div>
            <p className="text-text-muted text-sm">{t("token.hint")}</p>
          </form>
        </>
      )}
    </Card>
  );
}

function ActionsCard() {
  const t = useTranslations("dev.hosthub");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const when = useWhen();
  const overview = useQuery(trpc.dev.hosthub.overview.queryOptions());
  const [confirm, setConfirm] = useState<Confirm>(null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: trpc.dev.hosthub.overview.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.dev.hosthub.runs.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.dev.hosthub.errors.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.sync.status.queryKey() });
  }

  const sync = useMutation({
    ...trpc.dev.hosthub.sync.mutationOptions(),
    onSuccess: (result) => {
      setConfirm(null);
      refresh();
      if (result.outcome === "done") {
        showToast({
          message: t("actions.done", { created: result.created, updated: result.updated, errors: result.errors }),
          tone: result.errors > 0 ? "danger" : "success",
        });
      } else {
        showToast({ message: t(`actions.failed.${result.problem}`), tone: "danger" });
      }
    },
    onError: (error) => {
      setConfirm(null);
      showToast({ message: errorText(error), tone: "danger" });
    },
  });

  const reset = useMutation({
    ...trpc.dev.hosthub.resetCursor.mutationOptions(),
    onSuccess: () => {
      setConfirm(null);
      refresh();
      showToast({ message: t("actions.resetDone"), tone: "success" });
    },
    onError: (error) => {
      setConfirm(null);
      showToast({ message: errorText(error), tone: "danger" });
    },
  });

  const data = overview.data;
  const busy = sync.isPending || reset.isPending || data?.running === true;
  const cursorDate =
    data?.cursor && /^\d+$/.test(data.cursor) ? when(new Date(Number(data.cursor) * 1000).toISOString()) : null;

  return (
    <Card title={t("actions.title")}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-text-muted">{t("actions.lastSuccess")}</dt>
        <dd>{when(data?.lastSuccessAt) ?? t("never")}</dd>
        <dt className="text-text-muted">{t("actions.cursor")}</dt>
        <dd>{data?.cursor ? (cursorDate ?? data.cursor) : t("actions.cursorEmpty")}</dd>
        {data?.lastError ? (
          <>
            <dt className="text-text-muted">{t("actions.lastError")}</dt>
            <dd className="text-danger break-words">{data.lastError}</dd>
          </>
        ) : null}
      </dl>
      {data?.running ? (
        <p role="status" className="bg-warning-soft text-warning-text rounded-card p-3 font-medium">
          {t("actions.running")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          size="lg"
          icon={RefreshCw}
          disabled={busy}
          loading={sync.isPending && sync.variables?.full === false}
          onClick={() => sync.mutate({ full: false })}
        >
          {t("actions.incremental")}
        </Button>
        <Button size="lg" icon={RefreshCw} disabled={busy} onClick={() => setConfirm("full")}>
          {t("actions.full")}
        </Button>
        <Button size="lg" icon={RotateCcw} disabled={busy} onClick={() => setConfirm("reset")}>
          {t("actions.reset")}
        </Button>
      </div>
      <p className="text-text-muted text-sm">{t("actions.hint")}</p>
      {confirm ? (
        <div
          role="alertdialog"
          aria-labelledby="hh-confirm-title"
          className="border-border bg-surface-muted rounded-card flex flex-col gap-3 border p-4"
        >
          <h4 id="hh-confirm-title" className="text-lg font-semibold">
            {t(`confirm.${confirm}.title`)}
          </h4>
          <p>{t(`confirm.${confirm}.text`)}</p>
          <div className="flex gap-3">
            <Button
              variant="danger"
              size="lg"
              loading={sync.isPending || reset.isPending}
              onClick={() => (confirm === "full" ? sync.mutate({ full: true }) : reset.mutate())}
            >
              {t(`confirm.${confirm}.yes`)}
            </Button>
            <Button size="lg" onClick={() => setConfirm(null)}>
              {t("confirm.cancel")}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function WebhookCard() {
  const t = useTranslations("dev.hosthub.webhook");
  const trpc = useTRPC();
  const when = useWhen();
  const overview = useQuery(trpc.dev.hosthub.overview.queryOptions());
  const data = overview.data?.webhook;
  const url = data && typeof window !== "undefined" ? `${window.location.origin}${data.path}` : (data?.path ?? "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      showToast({ message: t("copied"), tone: "success" });
    } catch {
      /* the address is shown on screen and can be selected by hand */
    }
  }

  return (
    <Card title={t("title")}>
      {!data ? (
        <Skeleton variant="block" className="h-20" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <code className="bg-surface-muted min-w-0 flex-1 rounded-sm px-3 py-2 text-sm break-all">{url}</code>
            <Button icon={Copy} onClick={() => void copy()}>
              {t("copy")}
            </Button>
          </div>
          <p>
            {data.lastReceivedAt
              ? t("last", { when: when(data.lastReceivedAt) ?? "", count: data.receivedLast24h })
              : t("never")}
          </p>
          {!data.secretConfigured ? (
            <p role="status" className="bg-warning-soft text-warning-text rounded-card p-3 font-medium">
              {t("noSecret")}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

function RunsCard() {
  const t = useTranslations("dev.hosthub.runs");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const when = useWhen();
  const runs = useInfiniteQuery(
    trpc.dev.hosthub.runs.infiniteQueryOptions({}, { getNextPageParam: (last) => last.nextCursor ?? undefined }),
  );
  const rows: SyncRunRow[] = runs.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card title={t("title")}>
      {runs.isPending ? (
        <Skeleton variant="block" className="h-40" />
      ) : runs.error ? (
        <ErrorState message={errorText(runs.error)} onRetry={() => void runs.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={RefreshCw} title={t("empty")} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="text-text-muted text-sm">
                <tr className="border-border border-b">
                  <th className="py-2 pr-3 font-semibold">{t("when")}</th>
                  <th className="px-3 py-2 font-semibold">{t("duration")}</th>
                  <th className="px-3 py-2 font-semibold">{t("result")}</th>
                  <th className="px-3 py-2 font-semibold">{t("counts")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-border border-b">
                    <td className="py-2 pr-3">{when(r.startedAt)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.durationMs === null
                        ? t("notFinished")
                        : t("seconds", { value: Math.max(0.1, r.durationMs / 1000).toFixed(1) })}
                    </td>
                    <td className={cn("px-3 py-2 font-medium", r.status === "failed" && "text-danger")}>
                      {t(`status.${r.status}`)}
                    </td>
                    <td className="px-3 py-2">
                      {t("countsLine", {
                        fetched: r.fetched,
                        created: r.created,
                        updated: r.updated,
                        errors: r.errors,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {runs.hasNextPage ? (
            <div>
              <Button loading={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>
                {t("more")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function ErrorRow({ row }: { row: ImportErrorRow }) {
  const t = useTranslations("dev.hosthub.errors");
  const when = useWhen();
  const [open, setOpen] = useState(false);
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <li className="border-border border-b py-2">
      <button
        type="button"
        aria-expanded={open}
        className="hover:bg-surface-muted min-h-target flex w-full items-start gap-2 rounded-sm px-2 text-left"
        onClick={() => setOpen(!open)}
      >
        <Icon size={20} className="mt-3 shrink-0" aria-hidden="true" />
        <span className="flex min-w-0 flex-col py-2">
          <span className="font-medium break-words">{row.message}</span>
          <span className="text-text-muted text-sm">
            {when(row.createdAt)}
            {row.code ? ` · ${row.code}` : ""}
          </span>
        </span>
      </button>
      {open ? (
        <div className="px-2 pt-2">
          <p className="text-text-muted mb-1 text-sm">{t("payload")}</p>
          {row.payload === null ? (
            <p>{t("noPayload")}</p>
          ) : (
            <pre className="bg-surface-muted max-h-96 overflow-auto rounded-sm p-3 text-sm">
              {JSON.stringify(row.payload, null, 2)}
            </pre>
          )}
        </div>
      ) : null}
    </li>
  );
}

function ErrorsCard() {
  const t = useTranslations("dev.hosthub.errors");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const errors = useInfiniteQuery(
    trpc.dev.hosthub.errors.infiniteQueryOptions({}, { getNextPageParam: (last) => last.nextCursor ?? undefined }),
  );
  const rows: ImportErrorRow[] = errors.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card title={t("title")}>
      {errors.isPending ? (
        <Skeleton variant="block" className="h-40" />
      ) : errors.error ? (
        <ErrorState message={errorText(errors.error)} onRetry={() => void errors.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={RefreshCw} title={t("empty")} />
      ) : (
        <>
          <ul>
            {rows.map((r) => (
              <ErrorRow key={r.id} row={r} />
            ))}
          </ul>
          {errors.hasNextPage ? (
            <div>
              <Button loading={errors.isFetchingNextPage} onClick={() => void errors.fetchNextPage()}>
                {t("more")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** Dev mode: the Hosthub connection, sync history, import errors, sync buttons and the webhook. */
export function HosthubScreen() {
  const t = useTranslations("dev.hosthub");
  return (
    <div className="flex flex-col gap-6 p-8 phone:p-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <HosthubTokenCard />
      <ActionsCard />
      <WebhookCard />
      <RunsCard />
      <ErrorsCard />
    </div>
  );
}
