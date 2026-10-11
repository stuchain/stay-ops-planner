"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Printer, Wand2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { canPlace, type IsoDate, type Occupant } from "@stay-ops/domain";
import { useErrorText } from "@/api/errors";
import { useOnline } from "@/api/online";
import type { CalendarBooking } from "@/api/types";
import { BookingBar } from "@/ui/BookingBar";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ErrorState } from "@/ui/ErrorState";
import { IconButton } from "@/ui/IconButton";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { sheetStart } from "@/features/print/layout";
import { ArrangeMonthPanel } from "./ArrangeMonthPanel";
import { BookingPanel } from "./BookingPanel";
import { useUnsavedGuard } from "./useUnsavedGuard";
import { CalendarGrid, LABEL_WIDTH, type DropState } from "./CalendarGrid";
import { Tray } from "./Tray";
import { addMonths, blocksToLoad, DAY_WIDTH, dateAt, dayIndex, monthStart, spanAround, type Zoom } from "./timeline";
import { useCalendarData } from "./useCalendarData";
import { useMoveBooking, type MoveRequest } from "./useMoveBooking";

export type CalendarScreenProps = {
  /** Today in the business time zone, from the server. */
  today: IsoDate;
};

/** Free or busy for each apartment if `booking` went there, from what is loaded (E1 "show before it happens"). */
function dropStatesFor(
  booking: CalendarBooking | null,
  bookings: Map<string, CalendarBooking>,
  blocks: { id: string; roomId: string; start: IsoDate; end: IsoDate }[],
  roomIds: string[],
): Map<string, DropState> {
  const out = new Map<string, DropState>();
  if (!booking || booking.status === "pending") return out;
  const timelines = new Map<string, Occupant[]>(roomIds.map((id) => [id, []]));
  for (const b of bookings.values()) {
    if (!b.assignment) continue;
    timelines.get(b.assignment.roomId)?.push({
      kind: "booking",
      id: b.id,
      stay: { checkin: b.checkin, checkout: b.checkout },
      guestName: b.guestName ?? undefined,
    });
  }
  for (const b of blocks)
    timelines.get(b.roomId)?.push({ kind: "block", id: b.id, stay: { checkin: b.start, checkout: b.end } });
  for (const roomId of roomIds) {
    if (booking.assignment?.roomId === roomId) continue;
    const result = canPlace({ checkin: booking.checkin, checkout: booking.checkout }, timelines.get(roomId) ?? [], {
      ignoreBookingId: booking.id,
    });
    if (result.ok) out.set(roomId, { state: "free" });
    else if (result.reason === "INVALID_STAY") out.set(roomId, null);
    else
      out.set(roomId, {
        state: "busy",
        ...(result.clash.kind === "booking" && result.clash.guestName ? { guest: result.clash.guestName } : {}),
      });
  }
  return out;
}

export function CalendarScreen({ today }: CalendarScreenProps) {
  const t = useTranslations();
  const errorText = useErrorText();
  const searchParams = useSearchParams();
  const router = useRouter();
  const span = useMemo(() => spanAround(today), [today]);
  const [zoom, setZoom] = useState<Zoom>("month");
  const dayWidth = DAY_WIDTH[zoom];
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 1200 });
  // /app/calendar?booking=<id> (from the Today screen) opens that booking's panel.
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams?.get("booking") || null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<MoveRequest | null>(null);
  // "Τακτοποίησε τον μήνα": the month being arranged and the preview's placements, shown on the grid.
  const [arrangeMonth, setArrangeMonth] = useState<IsoDate | null>(null);
  const [proposed, setProposed] = useState<Map<string, string>>(() => new Map());
  const { setDirty, run, dialog } = useUnsavedGuard();
  // Opening another booking or closing the panel asks first when the edit form has unsaved changes.
  const select = useCallback(
    (id: string | null) => {
      if (id === selectedId) return;
      run(() => {
        setSelectedId(id);
        if (id === null) setConfirm(null);
        else setArrangeMonth(null);
      });
    },
    [run, selectedId],
  );

  const firstDay = Math.floor(view.left / dayWidth) - 7;
  const lastDay = Math.ceil((view.left + view.width - LABEL_WIDTH) / dayWidth) + 7;
  const blockIndexes = useMemo(() => blocksToLoad(span, firstDay, lastDay), [span, firstDay, lastDay]);
  const data = useCalendarData(span, blockIndexes);
  const askToConfirm = useCallback((request: MoveRequest) => {
    setSelectedId(request.booking.id);
    setConfirm(request);
  }, []);
  const online = useOnline();
  const { move, pending: movingNow } = useMoveBooking(data.rooms, askToConfirm);
  // Without internet the move buttons in the panel are off, like while a move is running.
  const moving = movingNow || !online;

  const selected = selectedId ? (data.bookings.get(selectedId) ?? null) : null;
  const dragging = draggingId ? (data.bookings.get(draggingId) ?? null) : null;
  const roomIds = useMemo(() => data.rooms.filter((r) => r.isActive).map((r) => r.id), [data.rooms]);
  const dropStates = useMemo(
    () => dropStatesFor(dragging ?? selected, data.bookings, data.blocks, roomIds),
    [dragging, selected, data.bookings, data.blocks, roomIds],
  );

  const scrollToDate = useCallback(
    (date: IsoDate, smooth = true) => {
      const el = scroller.current;
      if (!el) return;
      const left = Math.max(0, (dayIndex(span, date) - 2) * dayWidth);
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({ left, behavior: smooth && !reduce ? "smooth" : "auto" });
    },
    [span, dayWidth],
  );

  // Start at today once the rows are drawn, and keep the same first visible day when the zoom changes.
  const anchor = useRef<IsoDate>(today);
  const positioned = useRef(false);
  const hasRows = data.rooms.length > 0;
  useLayoutEffect(() => {
    if (!hasRows) return;
    scrollToDate(anchor.current, false);
    positioned.current = true;
  }, [zoom, hasRows, scrollToDate]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setView({ left: el.scrollLeft, width: el.clientWidth });
    if (!positioned.current) return;
    const first = Math.max(0, Math.floor(el.scrollLeft / dayWidth) + 2);
    anchor.current = first < span.days ? dateAt(span, first) : today;
  }, [dayWidth, span, today]);

  useEffect(() => {
    onScroll();
    window.addEventListener("resize", onScroll);
    return () => window.removeEventListener("resize", onScroll);
  }, [onScroll]);

  const shiftMonth = useCallback(
    (months: number) => scrollToDate(addMonths(monthStart(anchor.current), months)),
    [scrollToDate],
  );

  // Keyboard (T also works on a Greek layout): ← → change month, T jumps to today, Esc closes the panel. Never while typing,
  // inside a widget that uses the arrows itself, over an open question, or with a modifier held.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [contenteditable=''], [role=radio]"))
        return;
      if (target?.closest("[role=slider], [role=tab], [role=listbox], [role=menu], [role=combobox]")) return;
      if (document.querySelector("[role=alertdialog]")) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === "Escape") select(null);
      else if (key === "ArrowLeft") shiftMonth(-1);
      else if (key === "ArrowRight") shiftMonth(1);
      else if (key === "t" || key === "\u03c4") scrollToDate(today);
      else return;
      if (key !== "Escape") event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shiftMonth, select, scrollToDate, today]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragStart(event: DragStartEvent) {
    setDraggingId((event.active.data.current as { bookingId?: string } | undefined)?.bookingId ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    const booking = draggingId ? data.bookings.get(draggingId) : undefined;
    setDraggingId(null);
    if (!booking || !event.over) return;
    if (event.over.id === "tray") {
      if (booking.assignment) void move({ booking, roomId: null });
      return;
    }
    const roomId = (event.over.data.current as { roomId?: string } | undefined)?.roomId;
    if (!roomId || roomId === booking.assignment?.roomId) return;
    const drop = dropStates.get(roomId);
    if (drop?.state === "busy") {
      // The server would refuse; open the panel so the reason and the free apartments are visible.
      select(booking.id);
      return;
    }
    void move({ booking, roomId });
  }

  // The paper copy of what is on screen: the week of the first visible day, or its month.
  const openPrint = () => router.push(`/app/calendar/print?view=${zoom}&from=${sheetStart(zoom, anchor.current)}`);

  const openArrange = () =>
    run(() => {
      setSelectedId(null);
      setConfirm(null);
      setArrangeMonth(monthStart(anchor.current));
    });
  const closeArrange = useCallback(() => {
    setArrangeMonth(null);
    setProposed(new Map());
  }, []);

  const handleMove = (request: MoveRequest) => {
    setConfirm(null);
    void move(request);
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-4 p-8 max-[759px]:p-4",
        (selected || arrangeMonth) && "pr-[calc(var(--spacing-panel)+2rem)] max-[759px]:pr-4",
      )}
    >
      <PageHeader
        title={t("calendar.title")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <IconButton label={t("calendar.previousMonth")} icon={ChevronLeft} onClick={() => shiftMonth(-1)} />
            <Button onClick={() => scrollToDate(today)}>{t("calendar.today")}</Button>
            <IconButton label={t("calendar.nextMonth")} icon={ChevronRight} onClick={() => shiftMonth(1)} />
            <div role="group" aria-label={t("calendar.view")} className="border-border ml-2 flex rounded-sm border">
              {(["week", "month"] as const).map((z) => (
                <button
                  key={z}
                  type="button"
                  aria-pressed={zoom === z}
                  onClick={() => setZoom(z)}
                  className={cn(
                    "min-h-target text-sm px-4 font-semibold",
                    zoom === z ? "bg-accent text-white" : "bg-surface text-text",
                  )}
                >
                  {z === "week" ? t("calendar.week") : t("calendar.month")}
                </button>
              ))}
            </div>
            <Button icon={Printer} onClick={openPrint} className="ml-2">
              {t("calendar.print")}
            </Button>
            <Button icon={Wand2} onClick={openArrange} disabled={!online}>
              {t("calendar.arrangeButton")}
            </Button>
          </div>
        }
      />

      <DndContext
        sensors={sensors}
        autoScroll={false}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        <Tray
          bookings={data.unassigned}
          selectedId={selectedId}
          acceptsDrop={Boolean(dragging?.assignment)}
          onOpen={select}
        />

        {data.error && data.rooms.length === 0 ? (
          <ErrorState message={errorText(data.error)} onRetry={data.refetch} />
        ) : (
          <div
            ref={scroller}
            onScroll={onScroll}
            className="bg-surface border-border shadow-card rounded-card relative max-h-[calc(100vh-280px)] min-h-[300px] overflow-auto border"
            aria-label={t("calendar.gridLabel")}
            role="region"
            tabIndex={0}
          >
            {data.rooms.length === 0 && data.loading ? (
              <div className="flex flex-col gap-3 p-4">
                <Skeleton variant="bar" />
                <Skeleton variant="bar" />
                <Skeleton variant="bar" />
                <Skeleton variant="bar" />
              </div>
            ) : (
              <CalendarGrid
                span={span}
                dayWidth={dayWidth}
                firstDay={firstDay}
                lastDay={lastDay}
                today={data.today ?? today}
                rooms={data.rooms}
                bookings={[...data.bookings.values()]}
                blocks={data.blocks}
                overbooked={data.overbooked}
                selectedId={selectedId}
                dropStates={dropStates}
                proposed={proposed}
                onOpen={select}
              />
            )}
          </div>
        )}
        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <BookingBar
              guest={dragging.guestName ?? t("common.noName")}
              checkin={dragging.checkin}
              checkout={dragging.checkout}
              channel={dragging.channel}
              color={data.rooms.find((r) => r.id === dragging.assignment?.roomId)?.color ?? "#5B5852"}
              className="shadow-raised w-64"
              tabIndex={-1}
              aria-hidden="true"
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <BookingPanel
        booking={selected}
        rooms={data.rooms}
        today={data.today ?? today}
        confirm={confirm}
        moving={moving}
        onMove={handleMove}
        onCancelConfirm={() => setConfirm(null)}
        onClose={() => select(null)}
        onDirtyChange={setDirty}
      />
      <ArrangeMonthPanel month={arrangeMonth} rooms={data.rooms} onPreview={setProposed} onClose={closeArrange} />
      {dialog}
    </div>
  );
}
