"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Link2, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { addDays, type IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { TurnoverList, TurnoverTask } from "@/api/types";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { DateText } from "@/ui/DateText";
import { ErrorState } from "@/ui/ErrorState";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { showToast } from "@/ui/Toast";
import { CleanerLinkPanel, type CleanerLink } from "./CleanerLinkPanel";
import { TurnoverCard } from "./TurnoverCard";
import { useTurnoverActions, type TurnoverActions } from "./useTurnoverActions";

const PAGE_DAYS = 7;

function Loading() {
  const t = useTranslations("turnovers");
  return (
    <div role="status" aria-label={t("loading")} className="flex flex-col gap-6">
      <Skeleton variant="block" className="h-48" />
      <Skeleton variant="block" className="h-48" />
    </div>
  );
}

function DaySection({
  day,
  today,
  tasks,
  canEdit,
  actions,
  hiddenForPrint,
  onPrint,
}: {
  day: IsoDate;
  today: IsoDate;
  tasks: TurnoverTask[];
  canEdit: boolean;
  actions: TurnoverActions;
  hiddenForPrint: boolean;
  onPrint: (day: IsoDate) => void;
}) {
  const t = useTranslations("turnovers");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const [link, setLink] = useState<CleanerLink | null>(null);
  const createLink = useMutation(trpc.cleaning.createLink.mutationOptions({ meta: { handlesErrors: true } }));
  const headingId = `turnovers-day-${day}`;

  async function makeLink() {
    try {
      const result = await createLink.mutateAsync({ day });
      setLink({ url: `${window.location.origin}${result.path}`, expiresOn: result.expiresAt.slice(0, 10) as IsoDate });
    } catch (error) {
      showToast({ message: errorText(error), tone: "danger" });
    }
  }

  const tag = day === today ? t("todayTag") : day === addDays(today, 1) ? t("tomorrowTag") : null;

  return (
    <section aria-labelledby={headingId} className={cn("flex flex-col gap-3", hiddenForPrint && "print:hidden")}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="flex flex-wrap items-baseline gap-3 text-lg font-semibold">
          <DateText date={day} withYear />
          {tag ? <span className="bg-accent-soft text-accent rounded-pill px-3 py-0.5 text-sm">{tag}</span> : null}
        </h2>
        <div className="flex flex-wrap gap-2 print:hidden">
          {tasks.length > 0 ? (
            <Button icon={Printer} onClick={() => onPrint(day)}>
              {t("print")}
            </Button>
          ) : null}
          {canEdit ? (
            <Button
              icon={Link2}
              loading={createLink.isPending}
              loadingLabel={t("link.creating")}
              onClick={() => void makeLink()}
            >
              {t("link.create")}
            </Button>
          ) : null}
        </div>
      </header>

      {link ? <CleanerLinkPanel day={day} link={link} onClose={() => setLink(null)} /> : null}

      {tasks.length === 0 ? (
        <p className="text-text-muted text-base">{t("nothingThisDay")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tasks.map((task) => (
            <TurnoverCard key={task.id} task={task} canEdit={canEdit} actions={actions} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Days({ list, canEdit, actions }: { list: TurnoverList; canEdit: boolean; actions: TurnoverActions }) {
  const [printDay, setPrintDay] = useState<IsoDate | null>(null);

  // Only the chosen day goes to paper; the choice is dropped once printing is over.
  useEffect(() => {
    const done = () => setPrintDay(null);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);

  function print(day: IsoDate) {
    setPrintDay(day);
    // Let the other days hide before the print dialog takes a picture of the page.
    window.setTimeout(() => window.print(), 50);
  }

  const days = Array.from({ length: PAGE_DAYS }, (_, i) => addDays(list.from, i));
  return (
    <div className="flex flex-col gap-8">
      {days.map((day) => (
        <DaySection
          key={day}
          day={day}
          today={list.today}
          tasks={list.tasks.filter((task) => task.day === day)}
          canEdit={canEdit}
          actions={actions}
          hiddenForPrint={printDay !== null && printDay !== day}
          onPrint={print}
        />
      ))}
    </div>
  );
}

/**
 * The cleaning schedule: one section per day from today, a week at a time. Each cleaning shows who leaves, who
 * arrives next, the cleaning time and its state, with big buttons to say it is done.
 */
export function TurnoversScreen() {
  const t = useTranslations("turnovers");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const [page, setPage] = useState(0);
  const [showCancelled, setShowCancelled] = useState(false);
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

  return (
    <div className="flex flex-col gap-6 p-8 max-[759px]:p-4">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          list.data && (list.data.cancelledCount > 0 || showCancelled) ? (
            <Button
              icon={showCancelled ? EyeOff : Eye}
              className="print:hidden"
              onClick={() => setShowCancelled(!showCancelled)}
            >
              {showCancelled ? t("hideCancelled") : t("showCancelled", { count: list.data.cancelledCount })}
            </Button>
          ) : undefined
        }
      />
      {list.data ? (
        <>
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
