"use client";

import { Check, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CleanerDay, CleanerTask } from "@/api/types";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { formatDay } from "@/ui/format";
import { KindChip } from "@/features/turnovers/KindChip";

/** "2 ενήλικες, 1 παιδί"; babies are already counted with the children. */
function People({ people }: { people: NonNullable<CleanerTask["people"]> }) {
  const t = useTranslations("cleanerLink");
  const parts = [t("adults", { count: people.adults })];
  if (people.children > 0) parts.push(t("children", { count: people.children }));
  return <>{parts.join(", ")}</>;
}

/** One cleaning: the apartment, A-A / A / S, and how many people come (or stay). No times, names or notes. */
function TaskCard({ task }: { task: CleanerTask }) {
  const t = useTranslations("cleanerLink");
  return (
    <li className="bg-surface rounded-card shadow-card flex flex-col gap-4 p-5 print:break-inside-avoid print:border print:border-border print:shadow-none">
      <div className="flex flex-wrap items-center gap-3">
        <ApartmentChip name={task.apartment} className="text-xl" />
        <KindChip kind={task.kind} />
        <span className="text-lg">{t(`kinds.${task.kind}`)}</span>
        {task.status === "done" ? (
          <Badge tone="success" icon={Check} size="lg">
            {t("done")}
          </Badge>
        ) : null}
      </div>
      {task.nobodyBooked ? (
        <p className="text-text-muted text-xl">{t("nobodyBooked")}</p>
      ) : (
        <dl className="flex flex-col gap-1">
          <dt className="text-text-muted text-base">{task.kind === "S" ? t("staying") : t("coming")}</dt>
          <dd className="text-xl font-semibold">
            {task.people ? (
              <People people={task.people} />
            ) : (
              <span className="text-text-muted">{t("partyUnknown")}</span>
            )}
          </dd>
        </dl>
      )}
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
