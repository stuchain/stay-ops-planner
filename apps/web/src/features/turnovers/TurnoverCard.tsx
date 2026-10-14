"use client";

import { Check, ChevronDown, Clock, TriangleAlert, Undo2, UserRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import type { Party } from "@stay-ops/domain";
import type { TurnoverTask } from "@/api/types";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { compactFieldClass } from "@/ui/field";
import { formatDay, type UiLocale } from "@/ui/format";
import type { TurnoverActions } from "./useTurnoverActions";

const inputClass = compactFieldClass;

function PartyLine({ party }: { party: Party | null }) {
  const t = useTranslations("turnovers");
  if (!party) return <span className="text-text-muted">{t("partyUnknown")}</span>;
  const parts = [t("adults", { count: party.adults })];
  if (party.children > 0) parts.push(t("children", { count: party.children }));
  if (party.infants > 0) parts.push(t("infants", { count: party.infants }));
  return <span>{parts.join(", ")}</span>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-text-muted text-sm">{label}</dt>
      <dd className="text-base font-semibold">{children}</dd>
    </div>
  );
}

/** "Φεύγουν 11:00 · έρχονται 15:00 ίδια μέρα", with the same-day part in bold since it leaves little time. */
function TimesLine({ task }: { task: TurnoverTask }) {
  const t = useTranslations("turnovers");
  const locale = useLocale() as UiLocale;
  const leave = task.leaving.time;
  if (!task.next) return <>{t("line.nobody", { leave })}</>;
  if (task.next.sameDay) {
    const line = t.rich("line.sameDay", { leave, arrive: task.next.time, b: (chunks) => <strong>{chunks}</strong> });
    return <>{line}</>;
  }
  return <>{t("line.otherDay", { leave, date: formatDay(task.next.checkin, locale) })}</>;
}

function TimeForm({ task, actions, onSaved }: { task: TurnoverTask; actions: TurnoverActions; onSaved: () => void }) {
  const t = useTranslations("turnovers");
  const [start, setStart] = useState(task.start);
  const [end, setEnd] = useState(task.end);
  const busy = actions.busyId === task.id;
  return (
    <form
      className="flex flex-wrap items-end gap-3 print:hidden"
      onSubmit={(event) => {
        event.preventDefault();
        void actions.reschedule(task, start, end).then((ok) => ok && onSaved());
      }}
    >
      <span className="flex items-center gap-2 self-center text-base font-semibold">
        <Clock size={24} aria-hidden="true" />
        {t("window")}
      </span>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t("timeFrom")}
        <input type="time" required className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t("timeTo")}
        <input type="time" required className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <Button type="submit" variant="primary" loading={busy}>
        {t("saveTime")}
      </Button>
    </form>
  );
}

function AssigneeForm({
  task,
  actions,
  onSaved,
}: {
  task: TurnoverTask;
  actions: TurnoverActions;
  onSaved: () => void;
}) {
  const t = useTranslations("turnovers");
  const [draft, setDraft] = useState(task.assigneeName ?? "");
  const busy = actions.busyId === task.id;
  return (
    <form
      className="flex flex-wrap items-center gap-2 print:hidden"
      onSubmit={(event) => {
        event.preventDefault();
        void actions.setAssignee(task, draft.trim() === "" ? null : draft.trim()).then((ok) => ok && onSaved());
      }}
    >
      <label className="flex items-center gap-2 text-base font-semibold">
        <UserRound size={24} aria-hidden="true" />
        {t("assignee")}
        <input
          className={cn(inputClass, "w-56 font-normal")}
          value={draft}
          maxLength={80}
          placeholder={t("assigneePlaceholder")}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <Button type="submit" variant="primary" loading={busy}>
        {t("saveAssignee")}
      </Button>
    </form>
  );
}

/**
 * What "Αλλαγή" opens: who leaves and who comes, then the cleaning time and who cleans, as editors when they can
 * still change and as plain facts otherwise.
 */
function Details({
  task,
  canEdit,
  actions,
  onClose,
}: {
  task: TurnoverTask;
  canEdit: boolean;
  actions: TurnoverActions;
  onClose: () => void;
}) {
  const t = useTranslations("turnovers");
  const common = useTranslations("common");
  const locale = useLocale() as UiLocale;
  const closed = task.status === "done" || task.status === "cancelled";
  const guest = task.leaving.guestName ?? common("noName");
  const canEditTime = canEdit && !closed;
  const canEditAssignee = canEdit && task.status !== "cancelled";

  return (
    <div className="border-border flex flex-col gap-4 border-t pt-4">
      <dl className="grid grid-cols-3 gap-x-6 gap-y-3 narrow:grid-cols-1">
        <Fact label={t("leaving")}>{t("leavingAt", { guest, time: task.leaving.time })}</Fact>
        <Fact label={t("nextArrival")}>
          {task.next ? (
            <span className="flex flex-col">
              <span>
                {task.next.sameDay
                  ? t("sameDayAt", { time: task.next.time })
                  : t("onDayAt", { date: formatDay(task.next.checkin, locale), time: task.next.time })}
              </span>
              <span className="text-base font-normal">
                <PartyLine party={task.next.party} />
              </span>
            </span>
          ) : (
            <span className="text-text-muted">{t("nobodyComing")}</span>
          )}
        </Fact>
        {canEditTime ? null : <Fact label={t("window")}>{t("windowRange", { start: task.start, end: task.end })}</Fact>}
        {canEditAssignee ? null : (
          <Fact label={t("assignee")}>
            <span className={task.assigneeName ? undefined : "text-text-muted font-normal"}>
              {task.assigneeName ?? t("assigneeNone")}
            </span>
          </Fact>
        )}
      </dl>
      {canEditTime ? <TimeForm task={task} actions={actions} onSaved={onClose} /> : null}
      {canEditAssignee ? <AssigneeForm task={task} actions={actions} onSaved={onClose} /> : null}
      <div className="print:hidden">
        <Button variant="ghost" onClick={onClose}>
          {canEdit ? t("cancel") : t("close")}
        </Button>
      </div>
    </div>
  );
}

export type TurnoverCardProps = {
  task: TurnoverTask;
  canEdit: boolean;
  actions: TurnoverActions;
};

/**
 * One cleaning on one line: the apartment, when they leave and when the next guests come, and a big "Έγινε".
 * The rarer changes (time, who cleans) sit behind "Αλλαγή".
 */
export function TurnoverCard({ task, canEdit, actions }: TurnoverCardProps) {
  const t = useTranslations("turnovers");
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const busy = actions.busyId === task.id;
  const cancelled = task.status === "cancelled";
  const editable = canEdit && !cancelled;

  return (
    <li
      data-status={task.status}
      className={cn("flex flex-col gap-3 py-4 print:break-inside-avoid", cancelled && "opacity-70")}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <ApartmentChip name={task.room.name} color={task.room.color} className="text-base" />
        {task.taskType === "service" ? <Badge tone="info">{t("serviceTag")}</Badge> : null}
        <span className="min-w-0 flex-1 text-lg">
          {task.taskType === "service" ? (
            t("windowRange", { start: task.start, end: task.end })
          ) : (
            <TimesLine task={task} />
          )}
        </span>
        {task.status === "in_progress" ? <Badge tone="info">{t("status.in_progress")}</Badge> : null}
        {cancelled ? <Badge dashed>{t("status.cancelled")}</Badge> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            className="print:hidden"
            aria-expanded={open}
            aria-controls={detailsId}
            icon={ChevronDown}
            onClick={() => setOpen(!open)}
          >
            {editable ? t("change") : t("details")}
          </Button>
          {task.status === "done" ? (
            <>
              <span className="text-success-text flex items-center gap-2 text-lg font-semibold">
                <Check size={24} aria-hidden="true" />
                {t("status.done")}
              </span>
              {canEdit ? (
                <Button
                  variant="ghost"
                  icon={Undo2}
                  loading={busy}
                  className="print:hidden"
                  onClick={() => void actions.setStatus(task, "todo")}
                >
                  {t("reopen")}
                </Button>
              ) : null}
            </>
          ) : editable ? (
            <Button
              size="lg"
              variant="primary"
              icon={Check}
              loading={busy}
              className="print:hidden"
              onClick={() => void actions.setStatus(task, "done")}
            >
              {t("markDone")}
            </Button>
          ) : task.status === "todo" ? (
            <span className="text-text-muted text-base">{t("status.todo")}</span>
          ) : null}
        </div>
      </div>

      {task.conflictsWith.length > 0 ? (
        <p
          role="alert"
          className="bg-warning-soft text-warning-text flex items-center gap-2 rounded-sm p-3 text-base font-semibold"
        >
          <TriangleAlert size={24} aria-hidden="true" />
          {t("conflict", { name: task.assigneeName ?? "" })}
        </p>
      ) : null}

      {task.notes ? (
        <p className="text-base">
          <span className="font-semibold">{t("notes")}:</span> {task.notes}
        </p>
      ) : null}

      <div id={detailsId} hidden={!open}>
        {open ? <Details task={task} canEdit={canEdit} actions={actions} onClose={() => setOpen(false)} /> : null}
      </div>
    </li>
  );
}
