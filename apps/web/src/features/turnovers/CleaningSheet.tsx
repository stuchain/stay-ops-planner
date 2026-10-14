"use client";

import { useLocale, useTranslations } from "next-intl";
import { addDays, type IsoDate } from "@stay-ops/domain";
import type { TurnoverList, TurnoverTask } from "@/api/types";
import { cn } from "@/ui/cn";
import { formatDay, type UiLocale } from "@/ui/format";
import { groupDays } from "./TurnoversScreen";

const KINDS: TurnoverTask["kind"][] = ["AA", "A", "S"];

/** Frames that still tell A-A, A and S apart on a black-and-white printer. */
const MARK: Record<TurnoverTask["kind"], string> = {
  AA: "border-4 border-double",
  A: "border-2",
  S: "border-2 border-dashed",
};

function KindMark({ kind, className }: { kind: TurnoverTask["kind"]; className?: string }) {
  const t = useTranslations("cleaningCalendar");
  return (
    <span
      className={cn(
        "border-ink inline-block min-w-12 px-2 text-center font-extrabold whitespace-nowrap",
        MARK[kind],
        className,
      )}
    >
      {t(`kinds.${kind}.short`)}
    </span>
  );
}

function DayTable({ day, tasks }: { day: IsoDate; tasks: TurnoverTask[] }) {
  const t = useTranslations("turnovers");
  const common = useTranslations("common");
  const locale = useLocale() as UiLocale;
  const noName = common("noName");
  const nobody = t("nobodyBooked");
  return (
    <table className="w-full table-fixed border-collapse break-inside-avoid">
      <caption className="pt-3 pb-1 text-left text-lg font-bold">{formatDay(day, locale, true)}</caption>
      <thead>
        <tr className="border-ink border-b-2 text-left text-sm">
          <th className="w-[22%] px-2 py-1">{t("sheet.apartment")}</th>
          <th className="w-[14%] px-2 py-1">{t("sheet.kind")}</th>
          <th className="px-2 py-1">{t("sheet.guest")}</th>
          <th className="w-[13%] px-2 py-1">{t("sheet.adults")}</th>
          <th className="w-[13%] px-2 py-1">{t("sheet.children")}</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => {
          const party = task.guest?.party ?? null;
          return (
            <tr key={task.id} className="border-ink border-b">
              <td className="px-2 py-2 font-bold whitespace-nowrap">{task.room.label}</td>
              <td className="px-2 py-2">
                <KindMark kind={task.kind} className="text-xl" />
              </td>
              <td className="px-2 py-2">{task.guest ? (task.guest.name ?? noName) : nobody}</td>
              <td className="px-2 py-2">{party?.adults}</td>
              <td className="px-2 py-2">{party ? party.children + party.infants : null}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The paper copy of the week (Stelios, 2026-10-14): a table per day with the apartment, A-A / A / S, who comes
 * (or stays for S) and how many adults and children. No times, cleaner, note or tick box. Shown only when printing.
 */
export function CleaningSheet({ list }: { list: TurnoverList }) {
  const t = useTranslations("turnovers");
  const tKinds = useTranslations("cleaningCalendar");
  const locale = useLocale() as UiLocale;
  const days = Array.from({ length: 7 }, (_, i) => addDays(list.from, i));
  const tasks = list.tasks.filter((task) => task.status !== "cancelled");
  const label = (day: IsoDate) => formatDay(day, locale);
  return (
    <div data-testid="cleaning-sheet" className="text-ink hidden flex-col gap-2 text-base print:flex">
      <header className="border-ink flex items-baseline justify-between border-b-4 pb-2">
        <p className="text-2xl font-bold">{t("sheet.title")}</p>
        <span>{t("sheet.range", { from: label(list.from), to: label(days.at(-1)!) })}</span>
      </header>
      {groupDays(days, tasks).map((group) =>
        group.kind === "day" ? (
          <DayTable key={group.day} day={group.day} tasks={group.tasks} />
        ) : (
          <p key={group.days[0]} className="py-1 italic">
            {group.days.length === 1
              ? t("empty.one", { day: label(group.days[0]!) })
              : t("empty.range", { from: label(group.days[0]!), to: label(group.days.at(-1)!) })}
          </p>
        ),
      )}
      <footer className="border-ink mt-2 flex flex-wrap gap-x-8 gap-y-2 border-t-2 pt-2 text-sm">
        {KINDS.map((kind) => (
          <span key={kind} className="flex items-center gap-2">
            <KindMark kind={kind} />
            {tKinds(`kinds.${kind}.name`)}
          </span>
        ))}
      </footer>
    </div>
  );
}
