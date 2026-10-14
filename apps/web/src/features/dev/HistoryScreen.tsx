"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, History } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useMemo, useState, type FormEvent } from "react";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { RouterInputs } from "@/api/types";
import { compactFieldClass } from "@/ui/field";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { showToast } from "@/ui/Toast";
import { auditSentence, type AuditRow, type AuditTranslators } from "./auditText";

type Filters = NonNullable<RouterInputs["dev"]["history"]["list"]["filters"]>;

const EMPTY: Draft = { from: "", to: "", entityType: "", action: "", userId: "", bookingId: "" };
type Draft = { from: string; to: string; entityType: string; action: string; userId: string; bookingId: string };

function toFilters(draft: Draft): Filters {
  const out: Filters = {};
  for (const key of Object.keys(draft) as Array<keyof Draft>) {
    const value = draft[key].trim();
    if (value) out[key] = value;
  }
  return out;
}

const field = compactFieldClass;

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="min-w-0">
      <h4 className="text-text-muted mb-1 text-sm font-semibold">{label}</h4>
      <pre className="bg-surface-muted max-h-72 overflow-auto rounded-sm p-3 text-sm break-words whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function AuditTableRow({ row, sentence, when }: { row: AuditRow; sentence: string; when: string }) {
  const t = useTranslations("dev.history");
  const [open, setOpen] = useState(false);
  const entityLabel = t.has(`entities.${row.entityType}` as "title")
    ? t(`entities.${row.entityType}` as "entities.booking")
    : row.entityType;
  return (
    <Fragment>
      <tr className="border-border border-b align-top">
        <td className="px-3 py-3 text-sm whitespace-nowrap tabular-nums">{when}</td>
        <td className="px-3 py-3 text-sm">{row.userEmail ?? t("system")}</td>
        <td className="px-3 py-3 text-base">{sentence}</td>
        <td className="px-3 py-3 text-sm">
          <span className="font-medium">{entityLabel}</span>
          <span className="text-text-muted block font-mono text-xs break-all">{row.entityId}</span>
        </td>
        <td className="py-2 pr-3 text-right">
          <Button
            variant="ghost"
            icon={open ? ChevronUp : ChevronDown}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? t("hideDetails") : t("showDetails")}
          </Button>
        </td>
      </tr>
      {open ? (
        <tr className="border-border bg-surface-muted/40 border-b">
          <td colSpan={5} className="px-3 py-4">
            <p className="mb-3 text-sm">
              <span className="text-text-muted">{t("rawAction")} </span>
              <span className="font-mono">{row.action}</span>
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <Json label={t("before")} value={row.before} />
              <Json label={t("after")} value={row.after} />
              <Json label={t("meta")} value={row.meta} />
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function download(csv: string, name: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Dev mode: the audit log, newest first, with filters and a CSV export of what the filters show. */
export function HistoryScreen() {
  const t = useTranslations("dev.history");
  const tBooking = useTranslations("history");
  const tActions = useTranslations("dev.history.actions");
  const locale = useLocale() === "en" ? "en" : "el";
  const errorText = useErrorText();
  const trpc = useTRPC();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [applied, setApplied] = useState<Filters>({});
  const [page, setPage] = useState(1);

  const options = useQuery(trpc.dev.history.options.queryOptions());
  const list = useQuery({
    ...trpc.dev.history.list.queryOptions({ filters: applied, page }),
    placeholderData: (previous) => previous,
  });
  const exportCsv = useMutation({
    ...trpc.dev.history.exportCsv.mutationOptions(),
    onSuccess: ({ csv, rows, truncated }) => {
      download(csv, `history-${new Date().toISOString().slice(0, 10)}.csv`);
      showToast({ message: t(truncated ? "exportedTruncated" : "exported", { count: rows }), tone: "success" });
    },
    onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
  });

  const translators = useMemo<AuditTranslators>(
    () => ({
      booking: (key, values) => tBooking(key as "other", values),
      action: Object.assign((key: string) => tActions(key as "booking_update"), {
        has: (key: string) => tActions.has(key as "booking_update"),
      }),
      unknown: () => t("unknownAction"),
    }),
    [tBooking, tActions, t],
  );
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "el" ? "el-GR" : "en-GB", {
        timeZone: "Europe/Athens",
        dateStyle: "short",
        timeStyle: "medium",
      }),
    [locale],
  );

  function apply(event: FormEvent) {
    event.preventDefault();
    setApplied(toFilters(draft));
    setPage(1);
  }
  function clear() {
    setDraft(EMPTY);
    setApplied({});
    setPage(1);
  }

  const data = list.data;
  const set = (key: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value });

  return (
    <div className="flex flex-col gap-6 p-8 phone:p-4">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button icon={Download} loading={exportCsv.isPending} onClick={() => exportCsv.mutate({ filters: applied })}>
            {t("export")}
          </Button>
        }
      />

      <form
        onSubmit={apply}
        className="bg-surface shadow-card rounded-card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        <label className="flex flex-col gap-2">
          <span className="font-medium">{t("from")}</span>
          <input type="date" className={field} value={draft.from} onChange={set("from")} />
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-medium">{t("to")}</span>
          <input type="date" className={field} value={draft.to} onChange={set("to")} />
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-medium">{t("entityType")}</span>
          <select className={field} value={draft.entityType} onChange={set("entityType")}>
            <option value="">{t("any")}</option>
            {(options.data?.entityTypes ?? []).map((value) => (
              <option key={value} value={value}>
                {t.has(`entities.${value}` as "title") ? t(`entities.${value}` as "entities.booking") : value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-medium">{t("action")}</span>
          <select className={field} value={draft.action} onChange={set("action")}>
            <option value="">{t("any")}</option>
            {(options.data?.actions ?? []).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-medium">{t("user")}</span>
          <select className={field} value={draft.userId} onChange={set("userId")}>
            <option value="">{t("anyUser")}</option>
            {(options.data?.users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-medium">{t("bookingId")}</span>
          <input className={field} value={draft.bookingId} onChange={set("bookingId")} autoComplete="off" />
        </label>
        <div className="flex gap-3 sm:col-span-2 lg:col-span-3">
          <Button type="submit" variant="primary" size="lg">
            {t("apply")}
          </Button>
          <Button size="lg" onClick={clear}>
            {t("clear")}
          </Button>
        </div>
      </form>

      {!data && list.isPending ? (
        <Skeleton variant="block" className="h-64" />
      ) : list.error && !data ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : data && data.items.length === 0 ? (
        <div className="bg-surface shadow-card rounded-card">
          <EmptyState icon={History} title={t("emptyTitle")} text={t("emptyText")} />
        </div>
      ) : data ? (
        <>
          <p role="status" className="text-text-muted">
            {t("count", { count: data.total })}
          </p>
          <div className="bg-surface shadow-card rounded-card overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead className="text-text-muted text-sm">
                <tr className="border-border border-b">
                  <th className="px-3 py-3 font-semibold">{t("when")}</th>
                  <th className="px-3 py-3 font-semibold">{t("who")}</th>
                  <th className="px-3 py-3 font-semibold">{t("what")}</th>
                  <th className="px-3 py-3 font-semibold">{t("about")}</th>
                  <th className="py-3 pr-3">
                    <span className="sr-only">{t("details")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <AuditTableRow
                    key={row.id}
                    row={row}
                    sentence={auditSentence(row, translators, locale)}
                    when={dateFormat.format(new Date(row.at))}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <nav className="flex items-center justify-between gap-3" aria-label={t("pager")}>
            <Button icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t("newer")}
            </Button>
            <span className="tabular-nums">{t("page", { page: data.page, pages: data.pages })}</span>
            <Button icon={ChevronRight} disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
              {t("older")}
            </Button>
          </nav>
        </>
      ) : null}
    </div>
  );
}
