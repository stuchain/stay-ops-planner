"use client";

import { Check, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Party } from "@stay-ops/domain";
import type { TurnoverTask } from "@/api/types";
import { ApartmentChip } from "@/ui/ApartmentChip";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { KindChip } from "./KindChip";
import type { TurnoverActions } from "./useTurnoverActions";

/** "2 ενήλικες, 1 παιδί". Babies count as children, as on the paper. */
export function usePeopleText() {
  const t = useTranslations("turnovers");
  return (party: Party | null): string | null => {
    if (!party) return null;
    const children = party.children + party.infants;
    const parts = [t("adults", { count: party.adults })];
    if (children > 0) parts.push(t("children", { count: children }));
    return parts.join(", ");
  };
}

/** Who the cleaning is for: the next guest for A-A and A, the guest staying for S, with how many people. */
export function GuestLine({ task }: { task: TurnoverTask }) {
  const t = useTranslations("turnovers");
  const common = useTranslations("common");
  const peopleText = usePeopleText();
  if (!task.guest) return <span className="text-text-muted">{t("nobodyBooked")}</span>;
  const guest = task.guest.name ?? common("noName");
  const people = peopleText(task.guest.party);
  return (
    <>
      <strong className="font-semibold">{guest}</strong>
      {people ? ` · ${people}` : null}
    </>
  );
}

export type TurnoverCardProps = {
  task: TurnoverTask;
  canEdit: boolean;
  actions: TurnoverActions;
  /** The list shows the red × for A and S; the calendar has it on the tag instead. */
  removable?: boolean;
};

/**
 * One cleaning on one line: the numbered apartment, A-A, A or S, who comes (or stays) and how many, and a big
 * "Έγινε". No times, cleaner or note (Stelios, 2026-10-14).
 */
export function TurnoverCard({ task, canEdit, actions, removable = false }: TurnoverCardProps) {
  const t = useTranslations("turnovers");
  const tKinds = useTranslations("cleaningCalendar");
  const busy = actions.busyId === task.id;
  const cancelled = task.status === "cancelled";
  const editable = canEdit && !cancelled;
  const open = task.status === "todo" || task.status === "in_progress";

  return (
    <li data-status={task.status} className={cn("flex flex-col gap-3 py-4", cancelled && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <ApartmentChip name={task.room.label} className="text-base" />
        <KindChip kind={task.kind} />
        <span className="min-w-0 flex-1 text-lg">
          <GuestLine task={task} />
        </span>
        {task.status === "in_progress" ? <Badge tone="info">{t("status.in_progress")}</Badge> : null}
        {cancelled ? <Badge dashed>{t("status.cancelled")}</Badge> : null}
        <div className="flex flex-wrap items-center gap-3">
          {removable && editable && open && task.kind !== "AA" ? (
            <button
              type="button"
              data-testid="cleaning-remove"
              aria-label={t("remove", { kind: tKinds(`kinds.${task.kind}.short`), room: task.room.label })}
              title={t("remove", { kind: tKinds(`kinds.${task.kind}.short`), room: task.room.label })}
              disabled={busy}
              onClick={() => void actions.remove(task)}
              className="bg-danger text-white min-h-target flex size-11 items-center justify-center rounded-full"
            >
              <X size={22} strokeWidth={3} aria-hidden="true" />
            </button>
          ) : null}
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
              onClick={() => void actions.setStatus(task, "done")}
            >
              {t("markDone")}
            </Button>
          ) : task.status === "todo" ? (
            <span className="text-text-muted text-base">{t("status.todo")}</span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
