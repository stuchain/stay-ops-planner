"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ListOrdered, RotateCcw, Save, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import type { IsoDate, ReasonCode, RuleName } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ConfirmButton } from "@/ui/ConfirmButton";
import { DateText } from "@/ui/DateText";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { IconButton } from "@/ui/IconButton";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { showToast } from "@/ui/Toast";

const field = "border-border bg-surface min-h-target rounded-sm border px-3 text-base";

/** The rules being edited (the saved shape, but mutable). */
type RecommenderConfig = { rules: { rule: RuleName; weight: number }[] };

const sameConfig = (a: RecommenderConfig | null, b: RecommenderConfig | null) =>
  JSON.stringify(a) === JSON.stringify(b);

function RulesEditor({
  draft,
  saved,
  onChange,
}: {
  draft: RecommenderConfig;
  saved: RecommenderConfig;
  onChange: (next: RecommenderConfig) => void;
}) {
  const t = useTranslations("dev.recommender");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const dirty = !sameConfig(draft, saved);

  const afterChange = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.dev.recommender.config.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.dev.recommender.debug.pathKey() });
  };
  const save = useMutation({
    ...trpc.dev.recommender.save.mutationOptions(),
    onSuccess: () => {
      afterChange();
      showToast({ message: t("saved"), tone: "success" });
    },
    onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
  });
  const reset = useMutation({
    ...trpc.dev.recommender.reset.mutationOptions(),
    onSuccess: (config) => {
      onChange(config);
      afterChange();
      showToast({ message: t("resetDone"), tone: "success" });
    },
    onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
  });

  function shift(index: number, delta: -1 | 1) {
    const rules = [...draft.rules];
    const [moved] = rules.splice(index, 1);
    if (!moved) return;
    rules.splice(index + delta, 0, moved);
    onChange({ rules });
  }
  function setWeight(index: number, text: string) {
    const weight = Number(text);
    if (text.trim() === "" || !Number.isInteger(weight)) return;
    onChange({
      rules: draft.rules.map((r, i) => (i === index ? { ...r, weight: Math.max(-100, Math.min(100, weight)) } : r)),
    });
  }

  return (
    <section className="bg-surface shadow-card rounded-card flex flex-col gap-4 p-5" aria-labelledby="rules-title">
      <div>
        <h2 id="rules-title" className="text-lg font-semibold">
          {t("rulesTitle")}
        </h2>
        <p className="text-text-muted">{t("rulesHint")}</p>
      </div>
      <ol className="flex flex-col gap-2">
        {draft.rules.map((setting, index) => {
          const name = t(`rules.${setting.rule}.name`);
          return (
            <li key={setting.rule} className="border-border flex flex-wrap items-center gap-3 border-b pb-2">
              <span className="text-text-muted w-6 text-right tabular-nums">{index + 1}</span>
              <div className="flex min-w-48 flex-1 flex-col">
                <span className="font-medium">{name}</span>
                <span className="text-text-muted text-sm">{t(`rules.${setting.rule}.hint`)}</span>
              </div>
              <label className="flex items-center gap-2">
                <span className="text-sm">{t("weight")}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={-100}
                  max={100}
                  step={1}
                  className={cn(field, "w-24")}
                  aria-label={t("weightOf", { rule: name })}
                  value={setting.weight}
                  onChange={(e) => setWeight(index, e.target.value)}
                />
              </label>
              <IconButton
                label={t("moveUp", { rule: name })}
                icon={ArrowUp}
                disabled={index === 0}
                onClick={() => shift(index, -1)}
              />
              <IconButton
                label={t("moveDown", { rule: name })}
                icon={ArrowDown}
                disabled={index === draft.rules.length - 1}
                onClick={() => shift(index, 1)}
              />
            </li>
          );
        })}
      </ol>
      {dirty ? (
        <p role="status" className="bg-warning-soft text-warning-text rounded-card p-3 font-medium">
          {t("unsaved")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          size="lg"
          icon={Save}
          disabled={!dirty}
          loading={save.isPending}
          onClick={() => save.mutate({ config: draft })}
        >
          {t("save")}
        </Button>
        <ConfirmButton
          size="lg"
          icon={RotateCcw}
          loading={reset.isPending}
          question={t("resetConfirm")}
          onConfirm={() => reset.mutate()}
        >
          {t("reset")}
        </ConfirmButton>
      </div>
    </section>
  );
}

function BookingPicker({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const t = useTranslations("dev.recommender");
  const tCommon = useTranslations("common");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text]);
  const list = useQuery(trpc.dev.recommender.bookings.queryOptions(query ? { query } : {}));

  return (
    <section className="bg-surface shadow-card rounded-card flex flex-col gap-4 p-5" aria-labelledby="pick-title">
      <div>
        <h2 id="pick-title" className="text-lg font-semibold">
          {t("pickTitle")}
        </h2>
        <p className="text-text-muted">{t("pickHint")}</p>
      </div>
      <label className="flex max-w-md flex-col gap-1.5">
        <span className="font-medium">{t("search")}</span>
        <span className="relative">
          <Search size={18} aria-hidden="true" className="text-text-muted absolute top-1/2 left-3 -translate-y-1/2" />
          <input
            type="search"
            className={cn(field, "w-full pl-10")}
            value={text}
            placeholder={t("searchPlaceholder")}
            onChange={(e) => setText(e.target.value)}
          />
        </span>
      </label>
      {list.isPending ? (
        <Skeleton variant="block" className="h-40" />
      ) : list.error ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <p className="text-text-muted">{t("noBookings")}</p>
      ) : (
        <ul className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
          {list.data.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                aria-pressed={b.id === selectedId}
                onClick={() => onSelect(b.id)}
                className={cn(
                  "border-border hover:bg-surface-muted min-h-target flex w-full flex-col items-start rounded-sm border px-3 py-2 text-left",
                  b.id === selectedId && "border-accent bg-accent-soft",
                )}
              >
                <span className="font-medium">{b.guestName ?? t("noName")}</span>
                <span className="text-text-muted text-sm">
                  <DateText date={b.checkin as IsoDate} to={b.checkout as IsoDate} showNights />
                  {b.partySize !== null ? ` · ${tCommon("people", { count: b.partySize })}` : ""}
                </span>
                {b.needsApartment ? (
                  <span className="text-warning-text text-sm font-medium">{t("needsApartment")}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RankingTable({ bookingId, config }: { bookingId: string; config: RecommenderConfig }) {
  const t = useTranslations("dev.recommender");
  const tReason = useTranslations("reason");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const apartments = useQuery(trpc.dev.apartments.list.queryOptions());
  const debug = useQuery({
    ...trpc.dev.recommender.debug.queryOptions({ bookingId, config }),
    placeholderData: (previous) => previous,
  });
  const names = useMemo(() => new Map((apartments.data ?? []).map((a) => [a.id, a.name])), [apartments.data]);

  if (debug.isPending) return <Skeleton variant="block" className="h-64" />;
  if (debug.error) return <ErrorState message={errorText(debug.error)} onRetry={() => void debug.refetch()} />;
  const rows = debug.data;
  return (
    <section className="bg-surface shadow-card rounded-card flex flex-col gap-3 p-5" aria-labelledby="rank-title">
      <h2 id="rank-title" className="text-lg font-semibold">
        {t("rankTitle")}
      </h2>
      <p className="text-text-muted">{t("rankHint")}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left">
          <thead className="text-text-muted text-sm">
            <tr className="border-border border-b">
              <th className="px-3 py-3 font-semibold">{t("place")}</th>
              <th className="px-3 py-3 font-semibold">{t("apartment")}</th>
              <th className="px-3 py-3 font-semibold">{t("availability")}</th>
              <th className="px-3 py-3 font-semibold">{t("reasons")}</th>
              {config.rules.map((r) => (
                <th key={r.rule} className="px-3 py-3 font-semibold">
                  {t(`rules.${r.rule as RuleName}.name`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.roomId}
                className={cn("border-border border-b align-top", row.recommended && "bg-accent-soft")}
              >
                <td className="px-3 py-3 tabular-nums">{index + 1}</td>
                <td className="px-3 py-3 font-medium">
                  {names.get(row.roomId) ?? row.roomId}
                  {row.recommended ? <span className="text-accent-text ml-2 text-sm">{t("recommended")}</span> : null}
                </td>
                <td className="px-3 py-3">
                  {row.available ? (
                    t("available")
                  ) : (
                    <span className="text-danger-text">
                      {t("notAvailable")}
                      {row.blockedByGuest ? ` (${row.blockedByGuest})` : ""}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <ul className="flex flex-col">
                    {row.reasons.map((code: ReasonCode) => (
                      <li key={code}>{tReason(code)}</li>
                    ))}
                  </ul>
                </td>
                {row.contributions.map((c) => (
                  <td key={c.rule} className="px-3 py-3 tabular-nums">
                    <span className="font-medium">{c.value}</span>
                    {c.value !== c.raw ? (
                      <span className="text-text-muted text-sm"> ({t("raw", { raw: c.raw })})</span>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Dev mode: why each apartment ranks where it does for a booking, and the rules behind it. */
export function RecommenderScreen() {
  const t = useTranslations("dev.recommender");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const config = useQuery(trpc.dev.recommender.config.queryOptions());
  const [draft, setDraft] = useState<RecommenderConfig | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  useEffect(() => {
    if (config.data) setDraft((current) => current ?? config.data);
  }, [config.data]);

  return (
    <div className="flex flex-col gap-6 p-8 max-[759px]:p-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {!draft || !config.data ? (
        config.error ? (
          <ErrorState message={errorText(config.error)} onRetry={() => void config.refetch()} />
        ) : (
          <Skeleton variant="block" className="h-64" />
        )
      ) : (
        <>
          <RulesEditor draft={draft} saved={config.data} onChange={setDraft} />
          <BookingPicker selectedId={bookingId} onSelect={setBookingId} />
          {bookingId ? (
            <RankingTable bookingId={bookingId} config={draft} />
          ) : (
            <EmptyState icon={ListOrdered} title={t("chooseTitle")} text={t("chooseText")} />
          )}
        </>
      )}
    </div>
  );
}
