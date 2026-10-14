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
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { canPlace, isIsoDate, type IsoDate, type Occupant } from "@stay-ops/domain";
import { useErrorText } from "@/api/errors";
import { useOnline } from "@/api/online";
import { useCanChange } from "@/features/shell/role";
import type { CalendarBooking } from "@/api/types";
import { BookingBar } from "@/ui/BookingBar";
import { Button } from "@/ui/Button";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { cn } from "@/ui/cn";
import { ErrorState } from "@/ui/ErrorState";
import { IconButton } from "@/ui/IconButton";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { sheetStart } from "@/features/print/layout";
import { ArrangeMonthPanel } from "./ArrangeMonthPanel";
import { MoreMenu } from "./MoreMenu";
import { BookingPanel } from "./BookingPanel";
import { useUnsavedGuard } from "./useUnsavedGuard";
import { CalendarGrid, LABEL_WIDTH, type DropState } from "./CalendarGrid";
import { Tray } from "./Tray";
import {
  addMonths,
  blocksToLoad,
  DAY_WIDTH,
  dateAt,
  dayIndex,
  createDrawnDaysStore,
  drawnDays,
  monthStart,
  spanAround,
  type Zoom,
} from "./timeline";
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
  // /app/calendar?date=YYYY-MM-DD (from search or the week) opens the calendar at that day instead of today.
  const [start] = useState<IsoDate>(() => {
    const wanted = searchParams?.get("date") ?? "";
    return isIsoDate(wanted) && dayIndex(span, wanted) >= 0 && dayIndex(span, wanted) < span.days ? wanted : today;
  });
  const [zoom, setZoom] = useState<Zoom>("month");
  const dayWidth = DAY_WIDTH[zoom];
  const scroller = useRef<HTMLDivElement>(null);
  // The day columns drawn; changes only every couple of weeks of scrolling (see drawnDays). The grid reads it
  // directly; this screen only follows which blocks of data to load.
  const [drawn] = useState(() =>
    createDrawnDaysStore(
      drawnDays(Math.max(0, dayIndex(span, start) - 2) * DAY_WIDTH.month, 1200, DAY_WIDTH.month, LABEL_WIDTH),
    ),
  );
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

  const blocksKey = useCallback(() => {
    const { firstDay, lastDay } = drawn.get();
    return blocksToLoad(span, firstDay, lastDay).join(",");
  }, [drawn, span]);
  const blockList = useSyncExternalStore(drawn.subscribe, blocksKey, blocksKey);
  // The months around the screen load first; once they are in, every other month loads too, so scrolling far
  // never shows empty rows that fill in a moment later.
  const [loadEverything, setLoadEverything] = useState(false);
  const blockIndexes = useMemo(
    () => (loadEverything ? span.blocks.map((_, i) => i) : blockList.split(",").filter(Boolean).map(Number)),
    [loadEverything, span, blockList],
  );
  const data = useCalendarData(span, blockIndexes);
  useEffect(() => {
    if (!data.loading && data.rooms.length > 0) setLoadEverything(true);
  }, [data.loading, data.rooms.length]);
  const askToConfirm = useCallback((request: MoveRequest) => {
    setSelectedId(request.booking.id);
    setConfirm(request);
  }, []);
  const online = useOnline();
  const canChange = useCanChange();
  const { move, pending: movingNow } = useMoveBooking(data.rooms, askToConfirm);
  // Without internet the move buttons in the panel are off, like while a move is running.
  const moving = movingNow || !online;

  const bookingList = useMemo(() => [...data.bookings.values()], [data.bookings]);
  const selected = selectedId ? (data.bookings.get(selectedId) ?? null) : null;
  const dragging = draggingId ? (data.bookings.get(draggingId) ?? null) : null;
  const roomIds = useMemo(() => data.rooms.filter((r) => r.isActive).map((r) => r.id), [data.rooms]);
  // The booking being placed: the one dragged, or one picked from the tray (no apartment yet). Every row says
  // whether it can go there and outlines its dates, so it is clear where it lands whatever month is on screen.
  const placing = dragging ?? (selected && !selected.assignment ? selected : null);
  const dropStates = useMemo(
    () => (placing ? dropStatesFor(placing, data.bookings, data.blocks, roomIds) : new Map<string, DropState>()),
    [placing, data.bookings, data.blocks, roomIds],
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

  // Brings a stay into view, centred, unless it is already all on screen. Used when a booking is picked from the
  // tray, which can hold stays months away from what the calendar shows.
  const revealStay = useCallback(
    (booking: CalendarBooking) => {
      const el = scroller.current;
      if (!el) return;
      const visible = el.clientWidth - LABEL_WIDTH;
      const from = (dayIndex(span, booking.checkin) + 0.5) * dayWidth;
      const to = (dayIndex(span, booking.checkout) + 0.5) * dayWidth;
      if (from >= el.scrollLeft && to <= el.scrollLeft + visible) return;
      // A stay longer than the screen starts near the left edge, like the month buttons.
      const left = to - from > visible - 4 * dayWidth ? from - 2 * dayWidth : (from + to - visible) / 2;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({ left: Math.max(0, left), behavior: reduce ? "auto" : "smooth" });
    },
    [span, dayWidth],
  );
  // Only when the person picks one (a tray card, or dragging one), so the calendar never jumps on its own later.
  const revealBooking = useCallback(
    (bookingId: string) => {
      const booking = data.bookings.get(bookingId);
      if (booking && !booking.assignment) revealStay(booking);
    },
    [data.bookings, revealStay],
  );
  const openFromTray = useCallback(
    (bookingId: string) => {
      select(bookingId);
      // After the panel has opened and narrowed the calendar, so the stay is not centred under the panel.
      requestAnimationFrame(() => revealBooking(bookingId));
    },
    [select, revealBooking],
  );

  // Start at today once the rows are drawn, and keep the same first visible day when the zoom changes.
  const anchor = useRef<IsoDate>(start);
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
    // Only a new step of drawn days re-renders the calendar; plain scrolling is left to the browser.
    drawn.set(drawnDays(el.scrollLeft, el.clientWidth, dayWidth, LABEL_WIDTH));
    if (!positioned.current) return;
    const first = Math.max(0, Math.floor(el.scrollLeft / dayWidth) + 2);
    anchor.current = first < span.days ? dateAt(span, first) : today;
  }, [drawn, dayWidth, span, today]);

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
    const bookingId = (event.active.data.current as { bookingId?: string } | undefined)?.bookingId ?? null;
    setDraggingId(bookingId);
    if (bookingId) revealBooking(bookingId);
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

  // The green outline in a row: the same move as dropping the bar there.
  const placeable = canChange && placing !== null && placing.status !== "pending";
  const placeIn = useCallback(
    (roomId: string) => {
      if (placing) void move({ booking: placing, roomId });
    },
    [placing, move],
  );

  const handleMove = (request: MoveRequest) => {
    setConfirm(null);
    void move(request);
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-4 p-8 phone:p-4",
        (selected || arrangeMonth) && "pr-[calc(var(--spacing-panel)+2rem)] phone:pr-4",
      )}
    >
      <PageHeader
        title={t("calendar.title")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <IconButton label={t("calendar.previousMonth")} icon={ChevronLeft} onClick={() => shiftMonth(-1)} />
            <Button onClick={() => scrollToDate(today)}>{t("calendar.today")}</Button>
            <IconButton label={t("calendar.nextMonth")} icon={ChevronRight} onClick={() => shiftMonth(1)} />
            <ChoiceGroup<"week" | "month">
              size="md"
              className="ml-2"
              label={t("calendar.view")}
              value={zoom}
              onChange={setZoom}
              choices={[
                { value: "week", label: t("calendar.week") },
                { value: "month", label: t("calendar.month") },
              ]}
            />
            <MoreMenu className="ml-2" onPrint={openPrint} />
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
          onOpen={openFromTray}
          {...(canChange && data.unassigned.some((b) => b.status !== "pending" && b.checkout > (data.today ?? today))
            ? { onArrange: openArrange, arrangeDisabled: !online }
            : {})}
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
                drawn={drawn}
                today={data.today ?? today}
                rooms={data.rooms}
                bookings={bookingList}
                blocks={data.blocks}
                overbooked={data.overbooked}
                selectedId={selectedId}
                dropStates={dropStates}
                proposed={proposed}
                placing={placing}
                onPlace={placeable ? placeIn : undefined}
                placeDisabled={moving}
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
              people={dragging.partySize}
              showDates
              className="shadow-raised w-72"
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
