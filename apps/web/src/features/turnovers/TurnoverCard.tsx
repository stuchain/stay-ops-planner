"use client";

import { Check, Clock, Play, TriangleAlert, Undo2, UserRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import type { Party } from "@stay-ops/domain";
import type { TurnoverTask } from "@/api/types";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { formatDay, type UiLocale } from "@/ui/format";
import type { TurnoverActions } from "./useTurnoverActions";

const inputClass =
  "min-h-target rounded-sm border border-border bg-surface px-3 py-2 text-base text-text placeholder:text-text-muted";

const statusTone: Record<TurnoverTask["status"], string> = {
  todo: "bg-surface-muted text-text border border-border",
  in_progress: "bg-warning-soft text-warning-text",
  done: "bg-success-soft text-success-text",
  cancelled: "bg-surface-muted text-text-muted border border-border border-dashed",
};

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
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-text-muted text-sm">{label}</dt>
      <dd className="text-base font-semibold">{children}</dd>
    </div>
  );
}

function AssigneeRow({ task, canEdit, actions }: { task: TurnoverTask; canEdit: boolean; actions: TurnoverActions }) {
  const t = useTranslations("turnovers");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const busy = actions.busyId === task.id;

  async function save() {
    const ok = await actions.setAssignee(task, draft.trim() === "" ? null : draft.trim());
    if (ok) setEditing(false);
  }

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-2 print:hidden"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
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
            autoFocus
          />
        </label>
        <Button type="submit" variant="primary" loading={busy}>
          {t("save")}
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>
          {t("cancel")}
        </Button>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-base">
      <UserRound size={24} aria-hidden="true" />
      <span className="font-semibold">{t("assignee")}:</span>
      <span className={task.assigneeName ? undefined : "text-text-muted"}>
        {task.assigneeName ?? t("assigneeNone")}
      </span>
      {canEdit && task.status !== "cancelled" ? (
        <Button
          variant="ghost"
          className="print:hidden"
          onClick={() => {
            setDraft(task.assigneeName ?? "");
            setEditing(true);
          }}
        >
          {t("change")}
        </Button>
      ) : null}
    </div>
  );
}

function TimeEditor({ task, actions, onClose }: { task: TurnoverTask; actions: TurnoverActions; onClose: () => void }) {
  const t = useTranslations("turnovers");
  const [start, setStart] = useState(task.start);
  const [end, setEnd] = useState(task.end);
  const busy = actions.busyId === task.id;
  return (
    <form
      className="flex flex-wrap items-end gap-3 print:hidden"
      onSubmit={(event) => {
        event.preventDefault();
        void actions.reschedule(task, start, end).then((ok) => ok && onClose());
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t("timeFrom")}
        <input type="time" required className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t("timeTo")}
        <input type="time" required className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <Button type="submit" variant="primary" loading={busy}>
        {t("save")}
      </Button>
      <Button variant="ghost" onClick={onClose}>
        {t("cancel")}
      </Button>
    </form>
  );
}

export type TurnoverCardProps = {
  task: TurnoverTask;
  canEdit: boolean;
  actions: TurnoverActions;
};

/** One cleaning: who leaves, who comes, when to clean, and the big buttons to say it is done. */
export function TurnoverCard({ task, canEdit, actions }: TurnoverCardProps) {
  const t = useTranslations("turnovers");
  const common = useTranslations("common");
  const locale = useLocale() as UiLocale;
  const [editingTime, setEditingTime] = useState(false);
  const busy = actions.busyId === task.id;
  const closed = task.status === "done" || task.status === "cancelled";
  const guest = task.leaving.guestName ?? common("noName");

  return (
    <li
      data-status={task.status}
      className={cn(
        "bg-surface rounded-card shadow-card flex flex-col gap-4 p-5 print:break-inside-avoid print:shadow-none print:border print:border-border",
        task.status === "cancelled" && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <ApartmentChip name={task.room.name} color={task.room.color ?? "#5B5852"} className="text-base" />
        {task.taskType === "service" ? (
          <span className="bg-accent-soft text-accent rounded-pill px-3 py-1 text-sm font-semibold">
            {t("serviceTag")}
          </span>
        ) : null}
        <span className={cn("rounded-pill px-3 py-1 text-sm font-semibold", statusTone[task.status])}>
          {t(`status.${task.status}`)}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-x-6 gap-y-3 max-[1099px]:grid-cols-1 print:grid-cols-3">
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
        <Fact label={t("window")}>
          <span className="flex flex-wrap items-center gap-2">
            <Clock size={20} aria-hidden="true" />
            {t("windowRange", { start: task.start, end: task.end })}
            {canEdit && !closed && !editingTime ? (
              <Button variant="ghost" className="print:hidden" onClick={() => setEditingTime(true)}>
                {t("editTime")}
              </Button>
            ) : null}
          </span>
        </Fact>
      </dl>

      {editingTime ? <TimeEditor task={task} actions={actions} onClose={() => setEditingTime(false)} /> : null}

      <AssigneeRow task={task} canEdit={canEdit} actions={actions} />

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

      {canEdit && task.status !== "cancelled" ? (
        <div className="flex flex-wrap gap-3 print:hidden">
          {task.status === "todo" ? (
            <Button size="lg" icon={Play} loading={busy} onClick={() => void actions.setStatus(task, "in_progress")}>
              {t("markStarted")}
            </Button>
          ) : null}
          {task.status !== "done" ? (
            <Button
              size="lg"
              variant="primary"
              icon={Check}
              loading={busy}
              onClick={() => void actions.setStatus(task, "done")}
            >
              {t("markDone")}
            </Button>
          ) : (
            <Button size="lg" icon={Undo2} loading={busy} onClick={() => void actions.setStatus(task, "todo")}>
              {t("reopen")}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}
