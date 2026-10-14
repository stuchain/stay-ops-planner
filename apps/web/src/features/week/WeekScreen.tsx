"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BrushCleaning, ChevronLeft, ChevronRight, LogIn, LogOut, Printer } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { addDays, isIsoDate, type IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { TodayStay, TurnoverTask, WeekDayData, WeekSummaryData } from "@/api/types";
import { Badge } from "@/ui/Badge";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ErrorState } from "@/ui/ErrorState";
import { formatDay, formatRange } from "@/ui/format";
import { IconButton } from "@/ui/IconButton";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";

/** A4 portrait, black on white, one day never split across pages when it fits. */
const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html, body { background: #fff !important; }
  [data-sonner-toaster] { display: none !important; }
  .week-sheet { font-size: 12pt; line-height: 1.3; padding: 0 !important; gap: 8pt !important; }
  .week-sheet, .week-sheet * { color: #000 !important; background-color: transparent !important; box-shadow: none !important; }
  .week-sheet .swatch-chip span[aria-hidden="true"] { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .week-sheet section { break-inside: avoid; border: 1px solid #000 !important; }
}
`;

function Line({ icon: Icon, title, count }: { icon: LucideIcon; title: string; count: number }) {
  return (
    <h3 className="flex items-center gap-2 text-base font-semibold">
      <Icon size={20} aria-hidden="true" />
      {title} <span className="text-text-muted font-normal">({count})</span>
    </h3>
  );
}

function StayItem({ stay, kind }: { stay: TodayStay; kind: "arrival" | "departure" }) {
  const t = useTranslations("week");
  const common = useTranslations("common");
  const pending = stay.status === "pending";
  const name = stay.guestName ?? common("noName");
  const people = stay.partySize === null ? common("unknownPeople") : common("people", { count: stay.partySize });
  const nights = common("nights", { count: stay.nights });
  return (
    <li>
      <Link
        href={`/app/calendar?booking=${stay.id}&date=${stay.checkin}`}
        className={cn(
          "hover:bg-surface-muted flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-sm px-2 py-2",
          pending && "text-text-muted",
        )}
      >
        <span className="min-w-0">
          <span className="font-semibold">{name}</span>
          <span className="text-text-muted text-sm">
            {" · "}
            {kind === "arrival" ? `${people}, ${nights}` : nights}
          </span>
          {pending ? <span className="text-warning-text text-sm font-semibold"> · {t("pending")}</span> : null}
          {kind === "arrival" && stay.guestNotes[0] ? (
            <span className="text-text-muted block text-sm break-words italic">{stay.guestNotes[0]}</span>
          ) : null}
        </span>
        <span className="swatch-chip">
          {stay.room ? (
            <ApartmentChip name={stay.room.name} color={stay.room.color} />
          ) : (
            <span className="text-warning-text text-sm font-semibold">{t("noApartment")}</span>
          )}
        </span>
      </Link>
    </li>
  );
}

function CleaningItem({ task }: { task: TurnoverTask }) {
  const t = useTranslations("week");
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 py-2">
      <span className="min-w-0">
        <span className="font-semibold">
          {task.start}–{task.end}
        </span>
        <span className="text-text-muted text-sm">
          {" · "}
          {task.assigneeName ? t("cleaner", { name: task.assigneeName }) : t("noCleaner")}
          {task.next?.sameDay ? ` · ${t("sameDayArrival", { time: task.next.time })}` : null}
          {task.status === "done" ? ` · ${t("done")}` : null}
        </span>
      </span>
      <span className="swatch-chip">
        <ApartmentChip name={task.room.name} color={task.room.color} />
      </span>
    </li>
  );
}

function Day({ day, today }: { day: WeekDayData; today: IsoDate }) {
  const t = useTranslations("week");
  const locale = useLocale();
  const quiet = day.arrivals.length === 0 && day.departures.length === 0 && day.cleanings.length === 0;
  const headingId = `week-day-${day.date}`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "bg-surface border-border rounded-card flex flex-col gap-3 border p-4",
        day.date === today && "ring-accent ring-2",
      )}
    >
      <h2 id={headingId} className="flex flex-wrap items-center gap-3 text-lg font-semibold">
        {formatDay(day.date, locale, true)}
        {day.date === today ? <Badge tone="info">{t("today")}</Badge> : null}
      </h2>
      {quiet ? (
        <p className="text-text-muted">{t("quietDay")}</p>
      ) : (
        <div className="grid grid-cols-3 gap-4 narrow:grid-cols-1 print:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Line icon={LogIn} title={t("arrivals")} count={day.arrivals.length} />
            {day.arrivals.length === 0 ? (
              <p className="text-text-muted px-2">{t("none")}</p>
            ) : (
              <ul>
                {day.arrivals.map((s) => (
                  <StayItem key={s.id} stay={s} kind="arrival" />
                ))}
              </ul>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Line icon={LogOut} title={t("departures")} count={day.departures.length} />
            {day.departures.length === 0 ? (
              <p className="text-text-muted px-2">{t("none")}</p>
            ) : (
              <ul>
                {day.departures.map((s) => (
                  <StayItem key={s.id} stay={s} kind="departure" />
                ))}
              </ul>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Line icon={BrushCleaning} title={t("cleanings")} count={day.cleanings.length} />
            {day.cleanings.length === 0 ? (
              <p className="text-text-muted px-2">{t("none")}</p>
            ) : (
              <ul>
                {day.cleanings.map((task) => (
                  <CleaningItem key={task.id} task={task} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Totals({ data }: { data: WeekSummaryData }) {
  const t = useTranslations("week");
  const sum = (pick: (d: WeekDayData) => unknown[]) => data.days.reduce((n, d) => n + pick(d).length, 0);
  return (
    <p className="text-base font-semibold" role="status">
      {t("totals", {
        arrivals: sum((d) => d.arrivals),
        departures: sum((d) => d.departures),
        cleanings: sum((d) => d.cleanings),
      })}
    </p>
  );
}

/** "Η εβδομάδα": Monday to Sunday, arrivals, departures and cleanings per day. Printable. Read-only. */
export function WeekScreen() {
  const t = useTranslations("week");
  const locale = useLocale();
  const errorText = useErrorText();
  const trpc = useTRPC();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [day, setDay] = useState<IsoDate | null>(() => {
    const wanted = params?.get("week") ?? "";
    return isIsoDate(wanted) ? wanted : null;
  });
  const week = useQuery({
    ...trpc.today.week.queryOptions(day ? { day } : {}),
    placeholderData: keepPreviousData,
  });

  const go = (next: IsoDate | null) => {
    setDay(next);
    router.replace(next ? `${pathname}?week=${next}` : (pathname ?? "/app/week"), { scroll: false });
  };
  const from = week.data?.from;

  return (
    <div className="week-sheet flex flex-col gap-6 p-8 phone:p-4">
      <style>{PRINT_CSS}</style>
      <PageHeader
        title={t("title")}
        subtitle={from ? formatRange(from, addDays(from, 6), locale, true) : t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <IconButton
              label={t("previous")}
              icon={ChevronLeft}
              disabled={!from}
              onClick={() => from && go(addDays(from, -7))}
            />
            <Button onClick={() => go(null)}>{t("thisWeek")}</Button>
            <IconButton
              label={t("next")}
              icon={ChevronRight}
              disabled={!from}
              onClick={() => from && go(addDays(from, 7))}
            />
            <Button icon={Printer} onClick={() => window.print()} disabled={!week.data}>
              {t("print")}
            </Button>
          </div>
        }
      />
      {week.isPending ? (
        <div role="status" aria-label={t("loading")} className="flex flex-col gap-4">
          <Skeleton variant="block" className="h-32" />
          <Skeleton variant="block" className="h-32" />
          <Skeleton variant="block" className="h-32" />
        </div>
      ) : week.isError ? (
        <ErrorState message={errorText(week.error)} onRetry={() => void week.refetch()} />
      ) : (
        <>
          <Totals data={week.data} />
          {week.data.days.map((d) => (
            <Day key={d.date} day={d} today={week.data.today} />
          ))}
        </>
      )}
    </div>
  );
}
