"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Link2, Lock, Plus, Printer, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { addDays, daysBetween, type IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { CleaningCalendar as CalendarData, CleaningRoom, CleaningStay, TurnoverTask } from "@/api/types";
import { useCanChange } from "@/features/shell/role";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ErrorState } from "@/ui/ErrorState";
import { IconButton } from "@/ui/IconButton";
import { formatDay, formatRange, type UiLocale } from "@/ui/format";
import { PageHeader } from "@/ui/PageHeader";
import { SidePanel } from "@/ui/SidePanel";
import { Skeleton } from "@/ui/Skeleton";
import { showToast, undoToast } from "@/ui/Toast";
import { CleanerLinkPanel } from "./CleanerLinkPanel";
import { TurnoverCard } from "./TurnoverCard";
import { useTurnoverActions } from "./useTurnoverActions";

/** Must match CALENDAR_DAYS on the server. */
const DAYS = 21;
/** Width of one day column and of the apartment names, in px. */
const DAY_PX = 76;
const HEAD_PX = 168;

type Kind = TurnoverTask["kind"];
const KINDS: Kind[] = ["AA", "A", "S"];

const KIND_STYLE: Record<Kind, string> = {
  AA: "border-warning bg-warning-soft text-warning-text",
  A: "border-accent bg-accent-soft text-accent",
  S: "border-text-muted bg-surface text-text border-dashed",
};

/** The Monday on or before a day. */
export function mondayOf(day: IsoDate): IsoDate {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

function browserToday(): IsoDate {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` as IsoDate;
}

/** An A-A is fixed to its day: one guest leaves and the next arrives that afternoon. */
export function isLocked(task: TurnoverTask): boolean {
  return task.kind === "AA";
}

function isOpen(task: TurnoverTask): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

function canMove(task: TurnoverTask): boolean {
  return isOpen(task) && task.movable !== null;
}

/** Whether the cleaning may move to this day: within its days, and not in the past. */
export function canMoveTo(task: TurnoverTask, day: IsoDate, today: IsoDate): boolean {
  const range = task.movable;
  return range !== null && day >= today && day >= range.from && (range.to === null || day <= range.to);
}

/** Who stays in the apartment on a day, who leaves that morning. */
function dayContext(stays: CleaningStay[], roomId: string, day: IsoDate) {
  const inRoom = stays.filter((s) => s.roomId === roomId);
  return {
    staying: inRoom.find((s) => s.checkin <= day && day < s.checkout) ?? null,
    leaving: inRoom.find((s) => s.checkout === day) ?? null,
  };
}

type KindChoice = { ok: true } | { ok: false; existing?: TurnoverTask };

/**
 * Which kinds fit a day in an apartment, as the server will judge them: S on a day guests stay all day; A after
 * the last guest who left, before anyone else arrives; A-A on the day itself of a same-day changeover. A or A-A is
 * refused while that checkout's cleaning is on the calendar.
 */
export function kindsFor(data: CalendarData, roomId: string, day: IsoDate): Record<Kind, KindChoice> {
  const inRoom = data.stays.filter((s) => s.roomId === roomId);
  const allDay = inRoom.some((s) => s.checkin < day && day < s.checkout);
  const left = inRoom.filter((s) => s.checkout <= day).sort((a, b) => (a.checkout < b.checkout ? 1 : -1))[0];
  const between = left ? inRoom.some((s) => s.checkin >= left.checkout && s.checkin < day) : false;
  const afterCheckout = !allDay && !between;
  const changeover = !!left && left.checkout === day && inRoom.some((s) => s.checkin === day);
  const existing = left
    ? data.tasks.find(
        (x) => x.room.id === roomId && x.taskType === "turnover" && (x.movable?.from ?? x.day) === left.checkout,
      )
    : undefined;
  const turnover = (fits: boolean): KindChoice =>
    !fits ? { ok: false } : existing ? { ok: false, existing } : { ok: true };
  return {
    AA: turnover(afterCheckout && changeover),
    A: turnover(afterCheckout),
    S: allDay ? { ok: true } : { ok: false },
  };
}

function KindChip({ kind, done }: { kind: Kind; done?: boolean }) {
  const t = useTranslations("cleaningCalendar");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1 rounded-sm border-2 px-2 text-base font-bold whitespace-nowrap",
        done ? "border-success bg-success-soft text-success-text" : KIND_STYLE[kind],
      )}
    >
      {done ? <Check size={16} aria-hidden="true" /> : kind === "AA" ? <Lock size={14} aria-hidden="true" /> : null}
      {t(`kinds.${kind}.short`)}
    </span>
  );
}

function CleaningTag({
  task,
  day,
  canChange,
  onOpen,
  onRemove,
  style,
}: {
  task: TurnoverTask;
  day: IsoDate;
  canChange: boolean;
  onOpen: (id: string) => void;
  onRemove: (task: TurnoverTask) => void;
  style: CSSProperties;
}) {
  const t = useTranslations("cleaningCalendar");
  const locale = useLocale() as UiLocale;
  const done = task.status === "done";
  const { listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: `cleaning:${task.id}`,
    data: { taskId: task.id, roomId: task.room.id },
    disabled: !canChange || !canMove(task),
  });
  const kindName = t(`kinds.${task.kind}.name`);
  const date = formatDay(day, locale);
  const label = [t("tag", { kind: kindName, room: task.room.name, date }), done ? t("legend.done") : null]
    .filter(Boolean)
    .join(", ");
  const removable = canChange && isOpen(task) && !isLocked(task);
  // Dragging is a mouse shortcut; the panel the tag opens has the same day change with buttons.
  return (
    <div
      className={cn("pointer-events-auto absolute", isDragging && "z-30")}
      style={{ ...style, ...(transform ? { transform: CSS.Translate.toString(transform) } : {}) }}
    >
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        data-testid="cleaning-tag"
        data-day={day}
        data-kind={task.kind}
        aria-label={label}
        title={label}
        onClick={() => onOpen(task.id)}
        className={cn(
          "shadow-card flex h-10 w-full items-center justify-center gap-1 rounded-sm border-2 text-base font-bold",
          done ? "border-success bg-success-soft text-success-text" : KIND_STYLE[task.kind],
          isDragging && "shadow-raised",
          canChange && canMove(task) && "cursor-grab active:cursor-grabbing",
        )}
      >
        {done ? <Check size={16} aria-hidden="true" /> : isLocked(task) ? <Lock size={14} aria-hidden="true" /> : null}
        {t(`kinds.${task.kind}.short`)}
      </button>
      {removable && !isDragging ? (
        <button
          type="button"
          data-testid="cleaning-remove"
          aria-label={t("removeTag", { kind: kindName, date })}
          title={t("removeTag", { kind: kindName, date })}
          onClick={() => onRemove(task)}
          className="bg-danger text-white shadow-card absolute -top-3 -right-3 flex size-7 items-center justify-center rounded-full"
        >
          <X size={16} strokeWidth={3} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function DayCell({
  room,
  day,
  today,
  canAdd,
  drop,
  onAdd,
}: {
  room: CleaningRoom;
  day: IsoDate;
  today: IsoDate;
  canAdd: boolean;
  /** While a cleaning is dragged: whether it may land here. */
  drop: boolean | null;
  onAdd: (roomId: string, day: IsoDate) => void;
}) {
  const t = useTranslations("cleaningCalendar");
  const locale = useLocale() as UiLocale;
  const past = day < today;
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${room.id}:${day}`,
    data: { roomId: room.id, day },
    disabled: past || drop === false,
  });
  const className = cn(
    "group border-border relative h-32 border-b border-l",
    day === today && "bg-accent-soft/60",
    past && "bg-surface-muted",
    drop === true && "bg-success-soft",
    isOver && "bg-accent-soft outline-accent outline-2 -outline-offset-2 outline-dashed",
  );
  if (past || !canAdd) return <div ref={setNodeRef} className={className} />;
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-testid="cleaning-cell"
      aria-label={t("addAt", { room: room.name, date: formatDay(day, locale) })}
      onClick={() => onAdd(room.id, day)}
      className={className}
    >
      <span
        aria-hidden="true"
        className="border-accent text-accent bg-accent-soft absolute bottom-2 left-1/2 hidden size-10 -translate-x-1/2 items-center justify-center rounded-sm border-2 border-dashed group-hover:flex group-focus-visible:flex"
      >
        <Plus size={22} strokeWidth={2.5} />
      </span>
    </button>
  );
}

/** The first day of a stay a service can go on: a full day of the stay, from today. Null when there is none. */
export function firstServiceDay(stay: CleaningStay, today: IsoDate): IsoDate | null {
  const first = addDays(stay.checkin, 1);
  const day = first > today ? first : today;
  return day < stay.checkout ? day : null;
}

function RoomRow({
  room,
  days,
  data,
  tasks,
  canChange,
  dragging,
  onAdd,
  onOpen,
  onRemove,
}: {
  room: CleaningRoom;
  days: IsoDate[];
  data: CalendarData;
  tasks: Array<{ task: TurnoverTask; day: IsoDate }>;
  canChange: boolean;
  dragging: TurnoverTask | null;
  onAdd: (roomId: string, day: IsoDate, kind?: Kind) => void;
  onOpen: (id: string) => void;
  onRemove: (task: TurnoverTask) => void;
}) {
  const t = useTranslations("cleaningCalendar");
  const tCommon = useTranslations("common");
  const first = days[0]!;
  const stays = data.stays.filter((s) => s.roomId === room.id);
  const noName = tCommon("noName");
  return (
    <div className="relative grid" style={{ gridTemplateColumns: `${HEAD_PX}px repeat(${DAYS}, ${DAY_PX}px)` }}>
      <div className="border-border bg-surface sticky left-0 z-20 flex flex-col justify-center border-b px-4">
        <span className="text-lg font-semibold">{room.name}</span>
        {room.capacity ? <span className="text-text-muted text-sm">{t("upTo", { count: room.capacity })}</span> : null}
      </div>
      {days.map((day) => (
        <DayCell
          key={day}
          room={room}
          day={day}
          today={data.today}
          canAdd={canChange}
          drop={dragging ? dragging.room.id === room.id && canMoveTo(dragging, day, data.today) : null}
          onAdd={onAdd}
        />
      ))}
      <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: HEAD_PX }}>
        {stays.map((stay) => {
          const start = Math.max(daysBetween(first, stay.checkin) + 0.5, 0);
          const end = Math.min(daysBetween(first, stay.checkout) + 0.5, DAYS);
          if (end <= 0 || start >= DAYS) return null;
          const nights = daysBetween(stay.checkin, stay.checkout);
          const guest = stay.guestName ?? noName;
          const serviceDay = canChange ? firstServiceDay(stay, data.today) : null;
          return (
            <div
              key={`${stay.id}:${stay.checkin}`}
              data-testid="cleaning-stay"
              className={cn(
                "border-border bg-surface-muted text-text absolute top-2 h-14 overflow-hidden rounded-sm border py-1.5 pl-2.5 text-sm leading-tight whitespace-nowrap",
                serviceDay ? "pr-11" : "pr-2.5",
                start === 0 && "rounded-l-none",
                stay.checkout <= data.today && "opacity-50",
              )}
              style={{ left: start * DAY_PX + 2, width: (end - start) * DAY_PX - 4 }}
            >
              <span className="block truncate text-base font-semibold">{guest}</span>
              {t("nights", { count: nights })}
              {serviceDay ? (
                <button
                  type="button"
                  data-testid="cleaning-add-service"
                  aria-label={t("addService", { guest })}
                  title={t("addService", { guest })}
                  onClick={() => onAdd(room.id, serviceDay, "S")}
                  className="border-text-muted bg-surface text-text pointer-events-auto absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border-2"
                >
                  <Plus size={18} strokeWidth={3} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          );
        })}
        {tasks.map(({ task, day }) => (
          <CleaningTag
            key={task.id}
            task={task}
            day={day}
            canChange={canChange}
            onOpen={onOpen}
            onRemove={onRemove}
            style={{ left: daysBetween(first, day) * DAY_PX + 4, width: DAY_PX - 8, top: 76 }}
          />
        ))}
      </div>
    </div>
  );
}

function DayStepper({
  day,
  onChange,
  min,
  max,
}: {
  day: IsoDate;
  onChange: (day: IsoDate) => void;
  min: IsoDate;
  max?: IsoDate | null;
}) {
  const t = useTranslations("cleaningCalendar");
  const locale = useLocale() as UiLocale;
  return (
    <div className="flex items-center gap-2">
      <IconButton
        icon={ChevronLeft}
        label={t("prevDay")}
        disabled={day <= min}
        onClick={() => onChange(addDays(day, -1))}
      />
      <span className="border-border flex-1 rounded-sm border px-3 py-2 text-center text-lg font-semibold">
        {formatDay(day, locale)}
      </span>
      <IconButton
        icon={ChevronRight}
        label={t("nextDay")}
        disabled={max != null && day >= max}
        onClick={() => onChange(addDays(day, 1))}
      />
    </div>
  );
}

function ContextLine({ data, roomId, day }: { data: CalendarData; roomId: string; day: IsoDate }) {
  const t = useTranslations("cleaningCalendar");
  const tCommon = useTranslations("common");
  const locale = useLocale() as UiLocale;
  const { staying, leaving } = dayContext(data.stays, roomId, day);
  const name = (s: CleaningStay) => s.guestName ?? tCommon("noName");
  const text =
    leaving && staying
      ? t("context.changeover", { leaving: name(leaving), arriving: name(staying) })
      : staying
        ? t("context.staying", { guest: name(staying), date: formatDay(staying.checkout, locale) })
        : leaving
          ? t("context.leaving", { guest: name(leaving) })
          : t("context.empty");
  return <p className="bg-surface-muted text-text-muted rounded-sm px-3 py-2 text-base">{text}</p>;
}

function preferredKind(choices: Record<Kind, KindChoice>, wanted?: Kind): Kind {
  if (wanted && choices[wanted].ok) return wanted;
  return KINDS.find((k) => choices[k].ok) ?? wanted ?? "A";
}

function AddPanel({
  data,
  start,
  onClose,
}: {
  data: CalendarData;
  start: { roomId: string; day: IsoDate; kind?: Kind | undefined } | null;
  onClose: () => void;
}) {
  const t = useTranslations("cleaningCalendar");
  const tTurnovers = useTranslations("turnovers");
  const locale = useLocale() as UiLocale;
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [day, setDay] = useState<IsoDate>(start?.day ?? data.today);
  const choices = start ? kindsFor(data, start.roomId, day) : null;
  const [picked, setPicked] = useState<Kind | null>(null);
  const kind = choices ? (picked && choices[picked].ok ? picked : preferredKind(choices, start?.kind)) : "A";
  const [notes, setNotes] = useState("");
  const add = useMutation({
    ...trpc.cleaning.add.mutationOptions(),
    meta: { handlesErrors: true },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: trpc.cleaning.pathKey() }),
  });
  const room = data.rooms.find((r) => r.id === start?.roomId);
  const chosen = choices?.[kind];

  async function save() {
    if (!room) return;
    try {
      await add.mutateAsync({ roomId: room.id, day, kind, notes: notes.trim() || null });
      showToast({ message: t("add.saved"), tone: "success" });
      onClose();
    } catch (error) {
      showToast({ message: errorText(error), tone: "danger" });
    }
  }

  const reason = (k: Kind, choice: KindChoice) =>
    choice.ok
      ? t(`kinds.${k}.name`)
      : choice.existing
        ? t("add.alreadyThere", { date: formatDay(choice.existing.day, locale) })
        : t(`add.notHere.${k}`);

  return (
    <SidePanel
      open={start !== null}
      onOpenChange={(open) => !open && onClose()}
      modal
      title={room ? t("add.title", { room: room.name }) : ""}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onClose}>{tTurnovers("cancel")}</Button>
          <Button
            variant="primary"
            size="lg"
            loading={add.isPending}
            disabled={!chosen?.ok}
            onClick={() => void save()}
          >
            {t("add.save")}
          </Button>
        </div>
      }
    >
      {room && choices ? (
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-base font-semibold">{t("add.day")}</legend>
            <DayStepper day={day} onChange={setDay} min={data.today} />
            <ContextLine data={data} roomId={room.id} day={day} />
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-base font-semibold">{t("add.kind")}</legend>
            <div className="grid grid-cols-3 gap-2">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  disabled={!choices[k].ok}
                  onClick={() => setPicked(k)}
                  className={cn(
                    "flex min-h-24 flex-col items-center justify-start gap-1.5 rounded-sm border-2 px-2 py-2 text-sm",
                    kind === k && choices[k].ok ? "border-accent bg-accent-soft" : "border-border bg-surface",
                    !choices[k].ok && "text-text-muted cursor-not-allowed opacity-60",
                  )}
                >
                  <KindChip kind={k} />
                  <span>{reason(k, choices[k])}</span>
                </button>
              ))}
            </div>
            {chosen?.ok ? <p className="text-text-muted text-base">{t(`kinds.${kind}.help`)}</p> : null}
          </fieldset>
          <label className="flex flex-col gap-2 text-base font-semibold">
            {t("add.note")}
            <input
              className="min-h-target border-border bg-surface text-text placeholder:text-text-muted rounded-sm border px-3 py-2 text-base font-normal"
              value={notes}
              maxLength={300}
              placeholder={t("add.notePlaceholder")}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </form>
      ) : null}
    </SidePanel>
  );
}

function MovableLine({ task }: { task: TurnoverTask }) {
  const t = useTranslations("cleaningCalendar");
  const locale = useLocale() as UiLocale;
  const range = task.movable;
  if (!range) return null;
  const text =
    task.kind === "S"
      ? t("detail.movableStay", { date: formatDay(range.to ?? task.day, locale) })
      : range.to
        ? t("detail.movableUntil", { date: formatDay(range.to, locale) })
        : t("detail.movableOpen");
  return <p className="text-text-muted text-base">{text}</p>;
}

function DetailPanel({
  data,
  task,
  canChange,
  onMove,
  onClose,
}: {
  data: CalendarData;
  task: TurnoverTask | null;
  canChange: boolean;
  onMove: (task: TurnoverTask, day: IsoDate) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTranslations("cleaningCalendar");
  const actions = useTurnoverActions();
  const min = task?.movable && task.movable.from > data.today ? task.movable.from : data.today;

  return (
    <SidePanel
      open={task !== null}
      onOpenChange={(open) => !open && onClose()}
      title={task ? t("detail.title", { room: task.room.name }) : ""}
    >
      {task ? (
        <div className="flex flex-col gap-6">
          <p className="flex items-center gap-3 text-base">
            <KindChip kind={task.kind} done={task.status === "done"} />
            <span className="font-semibold">{t(`kinds.${task.kind}.name`)}</span>
          </p>
          <ul className="flex flex-col">
            <TurnoverCard task={task} canEdit={canChange} actions={actions} />
          </ul>
          {canChange && isOpen(task) ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">{t("detail.day")}</h3>
              {isLocked(task) || !task.movable ? (
                <p className="bg-surface-muted text-text-muted flex items-center gap-2 rounded-sm px-3 py-2 text-base">
                  <Lock size={18} aria-hidden="true" />
                  {t("detail.locked")}
                </p>
              ) : (
                <>
                  <DayStepper
                    day={task.day}
                    min={min}
                    max={task.movable.to}
                    onChange={(day) => void onMove(task, day)}
                  />
                  <MovableLine task={task} />
                </>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </SidePanel>
  );
}

/**
 * The cleaning calendar: apartments as rows and three weeks of days, like the booking calendar. Stays are bars,
 * cleanings sit under them as A-A, A or S. Every checkout gets its cleaning by itself: A-A on a same-day changeover,
 * fixed to that day; A otherwise, which can be dragged to a later day up to the next arrival. The + on a stay adds
 * a service (S) during it. Clicking a day adds a cleaning there; the × on a cleaning removes it, with Undo.
 */
export function CleaningCalendar({ viewSwitch, onPrint }: { viewSwitch: ReactNode; onPrint: () => void }) {
  const t = useTranslations("cleaningCalendar");
  const tTurnovers = useTranslations("turnovers");
  const locale = useLocale() as UiLocale;
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const canChange = useCanChange();
  const [from, setFrom] = useState<IsoDate>(() => mondayOf(browserToday()));
  const [adding, setAdding] = useState<{ roomId: string; day: IsoDate; kind?: Kind | undefined } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [dragging, setDragging] = useState<{ taskId: string; roomId: string } | null>(null);
  /** Where a moved cleaning shows until the server's answer is back. */
  const [moved, setMoved] = useState<Record<string, IsoDate>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const calendar = useQuery({
    ...trpc.cleaning.calendar.queryOptions({ from }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const move = useMutation({ ...trpc.cleaning.move.mutationOptions(), meta: { handlesErrors: true } });
  const remove = useMutation({ ...trpc.cleaning.remove.mutationOptions(), meta: { handlesErrors: true } });
  const restore = useMutation({ ...trpc.cleaning.restore.mutationOptions(), meta: { handlesErrors: true } });
  const tCommon = useTranslations("common");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const data = calendar.data;
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(from, i)), [from]);

  // Start with today in view.
  const today = data?.today;
  useEffect(() => {
    if (!today || !scroller.current) return;
    const index = daysBetween(from, today);
    if (index >= 0 && index < DAYS) scroller.current.scrollLeft = Math.max(0, (index - 1) * DAY_PX);
  }, [today, from]);

  async function moveTo(task: TurnoverTask, day: IsoDate): Promise<boolean> {
    if (day === task.day) return true;
    setMoved((m) => ({ ...m, [task.id]: day }));
    try {
      await move.mutateAsync({ id: task.id, expectedVersion: task.version, day });
      showToast({ message: t("detail.moved", { date: formatDay(day, locale) }), tone: "success" });
      return true;
    } catch (error) {
      showToast({ message: errorText(error), tone: "danger" });
      return false;
    } finally {
      await queryClient.invalidateQueries({ queryKey: trpc.cleaning.pathKey() });
      setMoved((m) => {
        const rest = { ...m };
        delete rest[task.id];
        return rest;
      });
    }
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.cleaning.pathKey() });

  async function removeTask(task: TurnoverTask) {
    try {
      const { version } = await remove.mutateAsync({ id: task.id, expectedVersion: task.version });
      undoToast({
        message: t("detail.removed"),
        undoLabel: tCommon("undo"),
        onUndo: () =>
          void restore
            .mutateAsync({ id: task.id, expectedVersion: version })
            .then(() => showToast({ message: t("detail.restored"), tone: "success" }))
            .catch((error: unknown) => showToast({ message: errorText(error), tone: "danger" }))
            .finally(() => void refresh()),
      });
    } catch (error) {
      showToast({ message: errorText(error), tone: "danger" });
    } finally {
      await refresh();
    }
  }

  function onDragStart(event: DragStartEvent) {
    const current = event.active.data.current as { taskId: string; roomId: string } | undefined;
    setDragging(current ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    const active = dragging;
    setDragging(null);
    const over = event.over?.data.current as { roomId: string; day: IsoDate } | undefined;
    const task = data?.tasks.find((x) => x.id === active?.taskId);
    if (!task || !data || !over || over.roomId !== task.room.id || !canMoveTo(task, over.day, data.today)) return;
    void moveTo(task, over.day);
  }

  const todayLabel = tTurnovers("todayTag");
  const openTask = data?.tasks.find((x) => x.id === openId) ?? null;
  const shown = (data?.tasks ?? []).map((task) => ({ task, day: moved[task.id] ?? task.day }));
  const linkDays = [...new Set((data?.tasks ?? []).map((x) => x.day))].filter((d) => d >= (today ?? d)).sort();

  return (
    <div className="flex flex-col gap-5 p-8 max-[759px]:p-4">
      <PageHeader
        title={tTurnovers("title")}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {viewSwitch}
            {canChange ? (
              <Button icon={Link2} aria-expanded={linkOpen} onClick={() => setLinkOpen(!linkOpen)}>
                {tTurnovers("link.open")}
              </Button>
            ) : null}
            <Button icon={Printer} onClick={onPrint}>
              {tTurnovers("print")}
            </Button>
          </div>
        }
      />
      {canChange && linkOpen && data ? (
        <CleanerLinkPanel
          key={from}
          days={linkDays}
          dayLabel={(day) => formatDay(day, locale)}
          onClose={() => setLinkOpen(false)}
        />
      ) : null}
      <nav className="flex flex-wrap items-center gap-3">
        <IconButton icon={ChevronLeft} label={t("earlier")} onClick={() => setFrom(addDays(from, -14))} />
        <Button size="lg" onClick={() => setFrom(mondayOf(data?.today ?? browserToday()))}>
          {todayLabel}
        </Button>
        <IconButton icon={ChevronRight} label={t("later")} onClick={() => setFrom(addDays(from, 14))} />
        <span className="text-xl font-semibold">{formatRange(from, addDays(from, DAYS - 1), locale)}</span>
      </nav>
      <ul className="text-text-muted grid gap-2 text-base md:grid-cols-3">
        {KINDS.map((k) => (
          <li key={k} className="flex items-start gap-2">
            <KindChip kind={k} />
            <span>{t(`kinds.${k}.help`)}</span>
          </li>
        ))}
      </ul>
      {data ? (
        <DndContext
          accessibility={{
            screenReaderInstructions: { draggable: t("drag.help") },
            announcements: {
              onDragStart: () => t("drag.start"),
              onDragOver: () => undefined,
              onDragEnd: ({ over }) => (over ? t("drag.end") : t("drag.cancel")),
              onDragCancel: () => t("drag.cancel"),
            },
          }}
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <div
            ref={scroller}
            className="bg-surface rounded-card shadow-card overflow-x-auto"
            data-testid="cleaning-calendar"
          >
            <div style={{ width: HEAD_PX + DAYS * DAY_PX }}>
              <div className="grid" style={{ gridTemplateColumns: `${HEAD_PX}px repeat(${DAYS}, ${DAY_PX}px)` }}>
                <div className="bg-surface border-border sticky left-0 z-20 border-b" />
                {days.map((day) => {
                  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
                  return (
                    <div
                      key={day}
                      className={cn(
                        "border-border flex flex-col items-center border-b py-2 text-sm leading-tight",
                        day === data.today
                          ? "bg-accent text-white rounded-t-sm"
                          : weekday === 0 || weekday === 6
                            ? "bg-surface-muted text-text-muted"
                            : "text-text-muted",
                      )}
                    >
                      <span>{formatDay(day, locale).split(" ")[0]}</span>
                      <span className={cn("text-lg font-semibold", day !== data.today && "text-text")}>
                        {new Date(`${day}T00:00:00Z`).getUTCDate()}
                      </span>
                    </div>
                  );
                })}
              </div>
              {data.rooms.map((room) => (
                <RoomRow
                  key={room.id}
                  room={room}
                  days={days}
                  data={data}
                  tasks={shown.filter((x) => x.task.room.id === room.id && x.day >= from && x.day < data.to)}
                  canChange={canChange}
                  dragging={data.tasks.find((x) => x.id === dragging?.taskId) ?? null}
                  onAdd={(roomId, day, kind) => setAdding({ roomId, day, kind })}
                  onOpen={setOpenId}
                  onRemove={(task) => void removeTask(task)}
                />
              ))}
            </div>
          </div>
        </DndContext>
      ) : calendar.error ? (
        <ErrorState message={errorText(calendar.error)} onRetry={() => void calendar.refetch()} />
      ) : (
        <div role="status" aria-label={tTurnovers("loading")}>
          <Skeleton variant="block" className="h-96" />
        </div>
      )}
      {data && canChange ? <p className="text-text-muted text-base">{t("hint")}</p> : null}
      {data ? (
        <AddPanel
          key={adding ? `${adding.roomId}:${adding.day}` : "closed"}
          data={data}
          start={adding}
          onClose={() => setAdding(null)}
        />
      ) : null}
      {data ? (
        <DetailPanel
          data={data}
          task={openTask}
          canChange={canChange}
          onMove={moveTo}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}
