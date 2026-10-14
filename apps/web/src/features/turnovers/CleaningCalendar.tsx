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
import { Check, ChevronLeft, ChevronRight, Link2, Lock, Plus, Printer, SprayCan } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { addDays, daysBetween, type IsoDate } from "@stay-ops/domain";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { CleaningCalendar as CalendarData, CleaningRoom, CleaningStay, TurnoverTask } from "@/api/types";
import { useCanChange } from "@/features/shell/role";
import { Button } from "@/ui/Button";
import { ConfirmButton } from "@/ui/ConfirmButton";
import { cn } from "@/ui/cn";
import { ErrorState } from "@/ui/ErrorState";
import { IconButton } from "@/ui/IconButton";
import { formatDay, formatRange, type UiLocale } from "@/ui/format";
import { PageHeader } from "@/ui/PageHeader";
import { SidePanel } from "@/ui/SidePanel";
import { Skeleton } from "@/ui/Skeleton";
import { showToast } from "@/ui/Toast";
import { CleanerLinkPanel } from "./CleanerLinkPanel";
import { TurnoverCard } from "./TurnoverCard";
import { useTurnoverActions } from "./useTurnoverActions";

/** Must match CALENDAR_DAYS on the server. */
const DAYS = 21;
/** Width of one day column and of the apartment names, in px. */
const DAY_PX = 76;
const HEAD_PX = 168;
const TIME_PRESETS = [
  { time: "10:00", key: "morning" },
  { time: "12:00", key: "noon" },
  { time: "16:00", key: "afternoon" },
] as const;

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

/** A cleaning after a same-day changeover is fixed to its day: the next guest arrives that afternoon. */
export function isLocked(task: TurnoverTask): boolean {
  return task.taskType === "turnover" && task.next?.sameDay === true;
}

function canMove(task: TurnoverTask): boolean {
  return task.status !== "done" && task.status !== "cancelled" && !isLocked(task);
}

/** Who stays in the apartment on a day, who leaves that morning. */
function dayContext(stays: CleaningStay[], roomId: string, day: IsoDate) {
  const inRoom = stays.filter((s) => s.roomId === roomId);
  return {
    staying: inRoom.find((s) => s.checkin <= day && day < s.checkout) ?? null,
    leaving: inRoom.find((s) => s.checkout === day) ?? null,
  };
}

function CleaningTag({
  task,
  day,
  canChange,
  onOpen,
  style,
}: {
  task: TurnoverTask;
  day: IsoDate;
  canChange: boolean;
  onOpen: (id: string) => void;
  style: CSSProperties;
}) {
  const t = useTranslations("cleaningCalendar");
  const locale = useLocale() as UiLocale;
  const done = task.status === "done";
  const locked = isLocked(task);
  const { listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: `cleaning:${task.id}`,
    data: { taskId: task.id, roomId: task.room.id },
    disabled: !canChange || !canMove(task),
  });
  const label = [
    t("tag", { room: task.room.name, date: formatDay(day, locale), time: task.start }),
    done ? t("legend.done") : null,
    locked ? t("sameDay") : null,
  ]
    .filter(Boolean)
    .join(", ");
  // Dragging is a mouse shortcut; the panel the tag opens has the same day change with buttons.
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      data-testid="cleaning-tag"
      data-day={day}
      aria-label={label}
      title={label}
      onClick={() => onOpen(task.id)}
      style={{
        ...style,
        ...(transform ? { transform: CSS.Translate.toString(transform) } : {}),
      }}
      className={cn(
        "rounded-sm border-2 bg-surface absolute flex h-10 items-center justify-center gap-1 text-sm font-bold tabular-nums",
        "pointer-events-auto shadow-card",
        task.taskType !== "turnover" && "border-dashed",
        done ? "bg-success-soft text-success-text border-success" : "border-text-muted text-text",
        isDragging && "shadow-raised z-30",
        canChange && canMove(task) && "cursor-grab active:cursor-grabbing",
      )}
    >
      {done ? (
        <Check size={16} aria-hidden="true" />
      ) : locked ? (
        <Lock size={14} aria-hidden="true" />
      ) : (
        <SprayCan size={16} aria-hidden="true" />
      )}
      {task.start}
    </button>
  );
}

function DayCell({
  room,
  day,
  today,
  canAdd,
  dropDisabled,
  onAdd,
}: {
  room: CleaningRoom;
  day: IsoDate;
  today: IsoDate;
  canAdd: boolean;
  dropDisabled: boolean;
  onAdd: (roomId: string, day: IsoDate) => void;
}) {
  const t = useTranslations("cleaningCalendar");
  const locale = useLocale() as UiLocale;
  const past = day < today;
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${room.id}:${day}`,
    data: { roomId: room.id, day },
    disabled: past || dropDisabled,
  });
  const className = cn(
    "group border-border relative h-32 border-b border-l",
    day === today && "bg-accent-soft/60",
    past && "bg-surface-muted",
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

function RoomRow({
  room,
  days,
  data,
  tasks,
  canChange,
  draggingRoom,
  onAdd,
  onOpen,
}: {
  room: CleaningRoom;
  days: IsoDate[];
  data: CalendarData;
  tasks: Array<{ task: TurnoverTask; day: IsoDate }>;
  canChange: boolean;
  draggingRoom: string | null;
  onAdd: (roomId: string, day: IsoDate) => void;
  onOpen: (id: string) => void;
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
          dropDisabled={draggingRoom !== null && draggingRoom !== room.id}
          onAdd={onAdd}
        />
      ))}
      <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: HEAD_PX }}>
        {stays.map((stay) => {
          const start = Math.max(daysBetween(first, stay.checkin) + 0.5, 0);
          const end = Math.min(daysBetween(first, stay.checkout) + 0.5, DAYS);
          if (end <= 0 || start >= DAYS) return null;
          const nights = daysBetween(stay.checkin, stay.checkout);
          return (
            <div
              key={stay.id}
              data-testid="cleaning-stay"
              className={cn(
                "border-border bg-surface-muted text-text absolute top-2 h-14 overflow-hidden rounded-sm border px-2.5 py-1.5 text-sm leading-tight whitespace-nowrap",
                start === 0 && "rounded-l-none",
                stay.checkout <= data.today && "opacity-50",
              )}
              style={{ left: start * DAY_PX + 2, width: (end - start) * DAY_PX - 4 }}
            >
              <span className="block truncate text-base font-semibold">{stay.guestName ?? noName}</span>
              {t("nights", { count: nights })}
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
            style={{ left: daysBetween(first, day) * DAY_PX + 4, width: DAY_PX - 8, top: 76 }}
          />
        ))}
      </div>
    </div>
  );
}

function Choice({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "min-h-button rounded-sm border-2 px-4 text-base font-semibold",
        pressed ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface",
      )}
    >
      {children}
    </button>
  );
}

function DayStepper({ day, onChange, min }: { day: IsoDate; onChange: (day: IsoDate) => void; min: IsoDate }) {
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
      <IconButton icon={ChevronRight} label={t("nextDay")} onClick={() => onChange(addDays(day, 1))} />
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

function AddPanel({
  data,
  start,
  onClose,
}: {
  data: CalendarData;
  start: { roomId: string; day: IsoDate } | null;
  onClose: () => void;
}) {
  const t = useTranslations("cleaningCalendar");
  const tTurnovers = useTranslations("turnovers");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [day, setDay] = useState<IsoDate>(start?.day ?? data.today);
  const [time, setTime] = useState("12:00");
  const [who, setWho] = useState<string | null>(null);
  const [otherName, setOtherName] = useState("");
  const [notes, setNotes] = useState("");
  const add = useMutation({
    ...trpc.cleaning.add.mutationOptions(),
    meta: { handlesErrors: true },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: trpc.cleaning.pathKey() }),
  });
  const room = data.rooms.find((r) => r.id === start?.roomId);
  const namePlaceholder = tTurnovers("assigneePlaceholder");

  async function save() {
    if (!room) return;
    const name = who === "" ? otherName.trim() || null : who;
    try {
      await add.mutateAsync({ roomId: room.id, day, start: time, assigneeName: name, notes: notes.trim() || null });
      showToast({ message: t("add.saved"), tone: "success" });
      onClose();
    } catch (error) {
      showToast({ message: errorText(error), tone: "danger" });
    }
  }

  return (
    <SidePanel
      open={start !== null}
      onOpenChange={(open) => !open && onClose()}
      modal
      title={room ? t("add.title", { room: room.name }) : ""}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onClose}>{tTurnovers("cancel")}</Button>
          <Button variant="primary" size="lg" loading={add.isPending} onClick={() => void save()}>
            {t("add.save")}
          </Button>
        </div>
      }
    >
      {room ? (
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
            <legend className="mb-2 text-base font-semibold">{t("add.time")}</legend>
            <div className="flex flex-wrap gap-2">
              {TIME_PRESETS.map((p) => (
                <Choice key={p.time} pressed={time === p.time} onClick={() => setTime(p.time)}>
                  {p.time} <span className="text-text-muted block text-sm font-normal">{t(`add.${p.key}`)}</span>
                </Choice>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-base font-semibold">{tTurnovers("assignee")}</legend>
            <div className="flex flex-wrap gap-2">
              {data.cleaners.map((name) => (
                <Choice key={name} pressed={who === name} onClick={() => setWho(name)}>
                  {name}
                </Choice>
              ))}
              <Choice pressed={who === ""} onClick={() => setWho("")}>
                {t("add.otherName")}
              </Choice>
              <Choice pressed={who === null} onClick={() => setWho(null)}>
                {t("add.whoUnknown")}
              </Choice>
            </div>
            {who === "" ? (
              <input
                aria-label={t("add.otherName")}
                className="min-h-target border-border bg-surface text-text rounded-sm border px-3 py-2 text-base"
                value={otherName}
                maxLength={80}
                placeholder={namePlaceholder}
                onChange={(event) => setOtherName(event.target.value)}
                autoFocus
              />
            ) : null}
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
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const actions = useTurnoverActions();
  const remove = useMutation({
    ...trpc.cleaning.remove.mutationOptions(),
    meta: { handlesErrors: true },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: trpc.cleaning.pathKey() }),
  });

  async function removeTask(target: TurnoverTask) {
    try {
      await remove.mutateAsync({ id: target.id, expectedVersion: target.version });
      showToast({ message: t("detail.removed"), tone: "success" });
      onClose();
    } catch (error) {
      showToast({ message: errorText(error), tone: "danger" });
    }
  }

  return (
    <SidePanel
      open={task !== null}
      onOpenChange={(open) => !open && onClose()}
      title={task ? t("detail.title", { room: task.room.name }) : ""}
    >
      {task ? (
        <div className="flex flex-col gap-6">
          <ul className="flex flex-col">
            <TurnoverCard task={task} canEdit={canChange} actions={actions} />
          </ul>
          {canChange && task.status !== "cancelled" ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">{t("detail.day")}</h3>
              {isLocked(task) ? (
                <p className="bg-surface-muted text-text-muted flex items-center gap-2 rounded-sm px-3 py-2 text-base">
                  <Lock size={18} aria-hidden="true" />
                  {t("detail.locked")}
                </p>
              ) : task.status === "done" ? null : (
                <DayStepper day={task.day} min={data.today} onChange={(day) => void onMove(task, day)} />
              )}
            </section>
          ) : null}
          {canChange && !isLocked(task) && task.status !== "done" && task.status !== "cancelled" ? (
            <ConfirmButton
              variant="ghost"
              question={t("detail.removeQuestion")}
              loading={remove.isPending}
              onConfirm={() => void removeTask(task)}
            >
              {t("detail.remove")}
            </ConfirmButton>
          ) : null}
        </div>
      ) : null}
    </SidePanel>
  );
}

/**
 * The cleaning calendar: apartments as rows and three weeks of days, like the booking calendar. Stays are bars,
 * cleanings sit under them. Clicking a day on a row adds a cleaning there; dragging a cleaning moves it to another
 * day. A same-day changeover gets its cleaning by itself and keeps it on that day.
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
  const [adding, setAdding] = useState<{ roomId: string; day: IsoDate } | null>(null);
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

  function onDragStart(event: DragStartEvent) {
    const current = event.active.data.current as { taskId: string; roomId: string } | undefined;
    setDragging(current ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    const active = dragging;
    setDragging(null);
    const over = event.over?.data.current as { roomId: string; day: IsoDate } | undefined;
    const task = data?.tasks.find((x) => x.id === active?.taskId);
    if (!task || !over || over.roomId !== task.room.id) return;
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
      <div className="text-text-muted flex flex-wrap items-center gap-x-5 gap-y-2 text-base">
        <span className="flex items-center gap-2">
          <Lock size={16} aria-hidden="true" />
          {t("legend.auto")}
        </span>
        <span className="flex items-center gap-2">
          <span className="border-text-muted size-4 rounded-[4px] border-2 border-dashed" aria-hidden="true" />
          {t("legend.added")}
        </span>
        <span className="text-success-text flex items-center gap-2">
          <Check size={16} aria-hidden="true" />
          {t("legend.done")}
        </span>
      </div>
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
                  draggingRoom={dragging?.roomId ?? null}
                  onAdd={(roomId, day) => setAdding({ roomId, day })}
                  onOpen={setOpenId}
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
