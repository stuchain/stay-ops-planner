"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Link2, Printer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { addDays, type IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { TurnoverList, TurnoverTask } from "@/api/types";
import { Button } from "@/ui/Button";
import { DateText } from "@/ui/DateText";
import { ErrorState } from "@/ui/ErrorState";
import { formatDay, type UiLocale } from "@/ui/format";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { CleanerLinkPanel } from "./CleanerLinkPanel";
import { TurnoverCard } from "./TurnoverCard";
import { useTurnoverActions, type TurnoverActions } from "./useTurnoverActions";

const PAGE_DAYS = 7;

/** A day with cleanings, or a run of consecutive days without any. */
export type DayGroup = { kind: "day"; day: IsoDate; tasks: TurnoverTask[] } | { kind: "empty"; days: IsoDate[] };

/** Splits the days on screen into days with cleanings and runs of empty days, in order. */
export function groupDays(days: IsoDate[], tasks: TurnoverTask[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const day of days) {
    const dayTasks = tasks.filter((task) => task.day === day);
    const last = groups.at(-1);
    if (dayTasks.length > 0) groups.push({ kind: "day", day, tasks: dayTasks });
    else if (last?.kind === "empty") last.days.push(day);
    else groups.push({ kind: "empty", days: [day] });
  }
  return groups;
}

function Loading() {
  const t = useTranslations("turnovers");
  return (
    <div role="status" aria-label={t("loading")} className="flex flex-col gap-6">
      <Skeleton variant="block" className="h-48" />
      <Skeleton variant="block" className="h-48" />
    </div>
  );
}

/** "Σήμερα", "Αύριο" or the short date, for a day of the schedule. */
function useDayLabel(today: IsoDate) {
  const t = useTranslations("turnovers");
  const locale = useLocale() as UiLocale;
  return (day: IsoDate) =>
    day === today ? t("todayTag") : day === addDays(today, 1) ? t("tomorrowTag") : formatDay(day, locale);
}

/** One muted line for days with nothing to clean: "Σήμερα και αύριο δεν έχει καθάρισμα." */
function EmptyDays({ days, today }: { days: IsoDate[]; today: IsoDate }) {
  const t = useTranslations("turnovers");
  const label = useDayLabel(today);
  const first = days[0]!;
  const last = days.at(-1)!;
  const text =
    days.length === 2 && first === today
      ? t("empty.todayAndTomorrow")
      : days.length === 1
        ? t("empty.one", { day: label(first) })
        : t("empty.range", { from: label(first), to: label(last) });
  return (
    <p data-testid="turnovers-empty-days" className="text-text-muted px-1 text-base">
      {text}
    </p>
  );
}

function DaySection({
  day,
  today,
  tasks,
  canEdit,
  actions,
}: {
  day: IsoDate;
  today: IsoDate;
  tasks: TurnoverTask[];
  canEdit: boolean;
  actions: TurnoverActions;
}) {
  const t = useTranslations("turnovers");
  const headingId = `turnovers-day-${day}`;
  const tag = day === today ? t("todayTag") : day === addDays(today, 1) ? t("tomorrowTag") : null;

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface rounded-card shadow-card print:border-border flex flex-col px-5 pt-4 pb-1 print:break-inside-avoid print:border print:shadow-none"
    >
      <h2 id={headingId} className="flex flex-wrap items-baseline gap-3 text-lg font-semibold">
        <DateText date={day} withYear />
        {tag ? <span className="bg-accent-soft text-accent rounded-pill px-3 py-0.5 text-sm">{tag}</span> : null}
      </h2>
      <ul className="divide-border flex flex-col divide-y">
        {tasks.map((task) => (
          <TurnoverCard key={task.id} task={task} canEdit={canEdit} actions={actions} />
        ))}
      </ul>
    </section>
  );
}

function Days({ list, canEdit, actions }: { list: TurnoverList; canEdit: boolean; actions: TurnoverActions }) {
  const days = Array.from({ length: PAGE_DAYS }, (_, i) => addDays(list.from, i));
  return (
    <div className="flex flex-col gap-6">
      {groupDays(days, list.tasks).map((group) =>
        group.kind === "day" ? (
          <DaySection
            key={group.day}
            day={group.day}
            today={list.today}
            tasks={group.tasks}
            canEdit={canEdit}
            actions={actions}
          />
        ) : (
          <EmptyDays key={group.days[0]} days={group.days} today={list.today} />
        ),
      )}
    </div>
  );
}

/** The link panel for the days on screen; it starts empty again when the person turns the page. */
function LinkPanel({ list, onClose }: { list: TurnoverList; onClose: () => void }) {
  const label = useDayLabel(list.today);
  const days = [...new Set(list.tasks.filter((task) => task.status !== "cancelled").map((task) => task.day))].sort();
  return <CleanerLinkPanel key={list.from} days={days} dayLabel={label} onClose={onClose} />;
}

/**
 * The cleaning schedule, a week at a time from today: one card per day with cleanings, a line per cleaning with
 * a big "Έγινε", and one grey line for days with none. Sending the schedule to the cleaner and printing sit at
 * the top, once.
 */
export function TurnoversScreen() {
  const t = useTranslations("turnovers");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const [page, setPage] = useState(0);
  const [showCancelled, setShowCancelled] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const me = useQuery(trpc.me.get.queryOptions());
  const list = useQuery({
    ...trpc.cleaning.list.queryOptions({ page, showCancelled }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const actions = useTurnoverActions();
  const canEdit = me.data !== undefined && me.data.role !== "viewer";

  const pager = (
    <nav className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <Button size="lg" icon={ChevronLeft} disabled={page === 0} onClick={() => setPage(page - 1)}>
        {t("previousDays")}
      </Button>
      <Button size="lg" icon={ChevronRight} onClick={() => setPage(page + 1)}>
        {t("nextDays")}
      </Button>
    </nav>
  );

  const hasTasks = (list.data?.tasks.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6 p-8 max-[759px]:p-4">
      <PageHeader
        title={t("title")}
        actions={
          list.data ? (
            <div className="flex flex-wrap items-center gap-3 print:hidden">
              {canEdit ? (
                <Button icon={Link2} aria-expanded={linkOpen} onClick={() => setLinkOpen(!linkOpen)}>
                  {t("link.open")}
                </Button>
              ) : null}
              {hasTasks ? (
                <Button icon={Printer} onClick={() => window.print()}>
                  {t("print")}
                </Button>
              ) : null}
              {list.data.cancelledCount > 0 || showCancelled ? (
                <Button icon={showCancelled ? EyeOff : Eye} onClick={() => setShowCancelled(!showCancelled)}>
                  {showCancelled ? t("hideCancelled") : t("showCancelled", { count: list.data.cancelledCount })}
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />
      {list.data ? (
        <>
          {canEdit && linkOpen ? <LinkPanel list={list.data} onClose={() => setLinkOpen(false)} /> : null}
          {pager}
          <Days list={list.data} canEdit={canEdit} actions={actions} />
          {pager}
        </>
      ) : list.error ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <Loading />
      )}
    </div>
  );
}
