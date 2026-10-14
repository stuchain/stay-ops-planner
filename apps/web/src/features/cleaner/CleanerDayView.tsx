"use client";

import { Check, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { CleanerDay, CleanerTask } from "@/api/types";
import { Badge } from "@/ui/Badge";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { Button } from "@/ui/Button";
import { formatDay } from "@/ui/format";

function Party({ arrival }: { arrival: NonNullable<CleanerTask["arrival"]> }) {
  const t = useTranslations("cleanerLink");
  if (arrival.adults === null || arrival.children === null || arrival.infants === null) {
    return <span className="text-text-muted">{t("partyUnknown")}</span>;
  }
  const parts = [t("adults", { count: arrival.adults })];
  if (arrival.children > 0) parts.push(t("children", { count: arrival.children }));
  if (arrival.infants > 0) parts.push(t("infants", { count: arrival.infants }));
  return <span>{parts.join(", ")}</span>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-text-muted text-base">{label}</dt>
      <dd className="text-xl font-semibold">{children}</dd>
    </div>
  );
}

function TaskCard({ task }: { task: CleanerTask }) {
  const t = useTranslations("cleanerLink");
  const arrival = task.arrival;
  return (
    <li className="bg-surface rounded-card shadow-card flex flex-col gap-4 p-5 print:break-inside-avoid print:border print:border-border print:shadow-none">
      <div className="flex flex-wrap items-center gap-3">
        <ApartmentChip name={task.apartment} className="text-xl" />
        {task.status === "done" ? (
          <Badge tone="success" icon={Check} size="lg">
            {t("done")}
          </Badge>
        ) : null}
      </div>
      <dl className="flex flex-col gap-3">
        <Fact label={t("window")}>{t("windowRange", { start: task.start, end: task.end })}</Fact>
        <Fact label={t("leaving")}>{task.leaveTime}</Fact>
        <Fact label={t("nextArrival")}>
          {arrival ? (
            <span className="flex flex-col">
              <span>
                {arrival.sameDay
                  ? t("sameDayAt", { time: arrival.time })
                  : t("onDayAt", { date: formatDay(arrival.day, "el"), time: arrival.time })}
              </span>
              <span className="text-lg font-normal">
                <Party arrival={arrival} />
              </span>
            </span>
          ) : (
            <span className="text-text-muted">{t("nobodyComing")}</span>
          )}
        </Fact>
      </dl>
      {task.assigneeName ? (
        <p className="text-lg">
          <span className="font-semibold">{t("cleaner")}:</span> {task.assigneeName}
        </p>
      ) : null}
      {task.notes ? (
        <p className="text-lg">
          <span className="font-semibold">{t("notes")}:</span> {task.notes}
        </p>
      ) : null}
    </li>
  );
}

/** The cleaner's page for one day: large text, no guest names or contact details, printable. */
export function CleanerDayView({ data }: { data: CleanerDay }) {
  const t = useTranslations("cleanerLink");
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 p-4 pb-16 print:max-w-none print:p-0">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-xl">{formatDay(data.day, "el", true)}</p>
        <p className="text-text-muted text-base print:hidden">{t("readOnly")}</p>
      </header>
      {data.tasks.length === 0 ? (
        <p className="text-xl">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {data.tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </ul>
      )}
      {data.tasks.length > 0 ? (
        <div className="print:hidden">
          <Button size="lg" icon={Printer} onClick={() => window.print()}>
            {t("print")}
          </Button>
        </div>
      ) : null}
    </main>
  );
}
