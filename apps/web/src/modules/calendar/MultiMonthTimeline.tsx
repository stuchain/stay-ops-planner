"use client";

import { type CSSProperties } from "react";
import { useDndContext, useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CalendarBlockItem, CalendarBookingItem, CalendarMonthPayload } from "./calendarTypes";
import { TimelineBookingBar } from "./TimelineBookingBar";
import { isStayCheckoutAfterVisibleLastDay, type BookingSpanInMonth } from "./monthSpan";
import {
  blockOccupiesColumn,
  bookingSpanInRange,
  buildMultiMonthRange,
  dayOccupiedByBookingRange,
  formatMultiMonthRangeTitle,
  hasNextCheckinOnCheckoutDayRange,
  hasPriorCheckoutOnFirstNightDayRange,
  layoutRowsInRange,
  type MultiMonthRangeSpec,
} from "./rangeSpan";

function laneTestIdSuffix(room: { code?: string | null; id: string }): string {
  const raw = room.code?.trim() || room.id;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function nightsLabel(item: CalendarBookingItem): string {
  const s = new Date(`${item.startDate}T00:00:00.000Z`).getTime();
  const e = new Date(`${item.endDate}T00:00:00.000Z`).getTime();
  const n = Math.max(1, Math.round((e - s) / 86_400_000));
  return `${n} night${n === 1 ? "" : "s"}`;
}

function fmtDayPrice(amountCents: number, currency: string): string {
  const v = amountCents / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(0)} ${currency}`;
}

function mergePayloads(payloads: CalendarMonthPayload[]): {
  range: MultiMonthRangeSpec;
  rooms: CalendarMonthPayload["rooms"];
  bookings: CalendarBookingItem[];
  blocks: CalendarBlockItem[];
  markerCount: number;
  dailyRatesByRoomDay: CalendarMonthPayload["dailyRatesByRoomDay"];
} {
  const months = payloads.map((p) => p.month);
  const range = buildMultiMonthRange(months);
  const rooms = payloads[0]?.rooms ?? [];
  if (process.env.NODE_ENV === "development") {
    for (const p of payloads) {
      const a = p.rooms.map((r) => r.id).join(",");
      const b = rooms.map((r) => r.id).join(",");
      if (a !== b) {
        console.warn("[MultiMonthTimeline] room list mismatch across months", p.month);
      }
    }
  }

  const bookingById = new Map<string, CalendarBookingItem>();
  const blockById = new Map<string, CalendarBlockItem>();
  const markerKey = new Set<string>();
  let markerCount = 0;
  const dailyRatesByRoomDay: CalendarMonthPayload["dailyRatesByRoomDay"] = {};

  for (const p of payloads) {
    for (const it of p.items) {
      if (it.kind === "booking") bookingById.set(it.id, it);
      else blockById.set(it.id, it);
    }
    for (const m of p.markers) {
      const k = `${m.kind}:${m.bookingId ?? ""}:${m.severity}:${m.message}:${m.code ?? ""}`;
      if (!markerKey.has(k)) {
        markerKey.add(k);
        markerCount += 1;
      }
    }
    for (const [roomId, days] of Object.entries(p.dailyRatesByRoomDay ?? {})) {
      dailyRatesByRoomDay[roomId] = { ...(dailyRatesByRoomDay[roomId] ?? {}), ...days };
    }
  }

  return {
    range,
    rooms,
    bookings: [...bookingById.values()],
    blocks: [...blockById.values()],
    markerCount,
    dailyRatesByRoomDay,
  };
}

type UnifiedLaneProps = {
  laneId: string;
  testIdSuffix: string;
  title: string;
  roomId: string;
  items: CalendarBookingItem[];
  blocks: CalendarBlockItem[];
  allBookings: CalendarBookingItem[];
  spec: MultiMonthRangeSpec;
  /** YYYY-MM-DD of the last column in the unified range. */
  lastVisibleIso: string;
  dayKeys: number[];
  hintSpan: { start: number; endExclusive: number } | null;
  dailyRatesForRoom: Record<string, { amountCents: number; currency: string }> | undefined;
  monthBoundaryColumns: Set<number>;
  showSortHandle?: boolean;
  sortHandleProps?: Record<string, unknown>;
  rowRef?: (node: HTMLDivElement | null) => void;
  rowStyle?: CSSProperties;
  onBookingClick?: (bookingId: string) => void;
};

function UnifiedTimelineLane({
  laneId,
  testIdSuffix,
  title,
  roomId,
  items,
  blocks,
  allBookings,
  spec,
  lastVisibleIso,
  dayKeys,
  hintSpan,
  dailyRatesForRoom,
  monthBoundaryColumns,
  showSortHandle,
  sortHandleProps,
  rowRef,
  rowStyle,
  onBookingClick,
}: UnifiedLaneProps) {
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: laneId });
  const laidOut = layoutRowsInRange(items, spec);
  const maxLane = laidOut.reduce((m, x) => Math.max(m, x.lane), 0);
  const minHeight = Math.max(36, (maxLane + 1) * 30);
  const monthDayCount = spec.totalDayCount;
  const gridCols = `repeat(${monthDayCount}, minmax(28px, 1fr))`;

  return (
    <div
      ref={rowRef}
      className={`ops-timeline-row${isOver ? " ops-room-lane-over" : ""}`}
      style={{ ...rowStyle }}
      data-testid={`ops-room-lane-${testIdSuffix}`}
    >
      <div className="ops-timeline-room-label">
        {showSortHandle ? (
          <button
            type="button"
            className="ops-room-sort-handle"
            title="Drag to reorder rows"
            aria-label={`Reorder ${title}`}
            {...sortHandleProps}
          >
            ⣿
          </button>
        ) : null}
        <span className="ops-timeline-room-title">{title}</span>
      </div>
      <div ref={setDroppableRef} className="ops-timeline-track" style={{ minHeight }}>
        <div className="ops-timeline-day-grid" style={{ gridTemplateColumns: gridCols }}>
          {dayKeys.map((d) => {
            const isoDay = spec.columnToIso(d);
            const rate = dailyRatesForRoom?.[isoDay];
            const occupied =
              dayOccupiedByBookingRange(d, roomId, allBookings, spec) ||
              blockOccupiesColumn(d, roomId, blocks, spec);
            const showPrice = rate && !occupied;
            const boundary = monthBoundaryColumns.has(d);
            return (
              <div
                key={`${laneId}-${d}`}
                className={`ops-timeline-day-cell${boundary ? " ops-timeline-day-cell--month-start" : ""}`}
              >
                {showPrice ? (
                  <span className="ops-timeline-day-price">{fmtDayPrice(rate.amountCents, rate.currency)}</span>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="ops-timeline-bars" style={{ gridTemplateColumns: gridCols }}>
          {hintSpan && (
            <div
              className="ops-timeline-assign-hint"
              style={{ gridColumn: `${hintSpan.start} / ${hintSpan.endExclusive}`, gridRow: "1" }}
            >
              Drop to assign
            </div>
          )}
          {laidOut.map(({ item, lane }) => {
            const span = bookingSpanInRange(item.startDate, item.endDate, spec);
            const checkinCutIn =
              span.endExclusive > span.start && spec.columnToIso(span.start) === item.startDate.slice(0, 10);
            const checkinMatePriorCheckout = hasPriorCheckoutOnFirstNightDayRange(
              items,
              item.id,
              spec,
              span.start,
            );
            const turnoverOutgoing =
              span.checkoutDayInMonth != null &&
              hasNextCheckinOnCheckoutDayRange(items, item.id, spec, span.checkoutDayInMonth);
            return (
              <TimelineBookingBar
                key={item.id}
                item={item}
                lane={lane}
                span={span}
                checkinCutIn={checkinCutIn}
                checkinMatePriorCheckout={checkinMatePriorCheckout}
                turnoverIncoming={checkinMatePriorCheckout}
                turnoverOutgoing={turnoverOutgoing}
                nights={nightsLabel(item)}
                trailClipped={isStayCheckoutAfterVisibleLastDay(item.endDate, lastVisibleIso)}
                onOpen={onBookingClick ? () => onBookingClick(item.id) : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SortableUnifiedLane(
  props: Omit<UnifiedLaneProps, "showSortHandle" | "sortHandleProps" | "rowRef" | "rowStyle"> & {
    sortableId: string;
  },
) {
  const { sortableId, ...rest } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
  });
  const rowStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
  };
  return (
    <UnifiedTimelineLane
      {...rest}
      showSortHandle
      sortHandleProps={{ ...attributes, ...listeners }}
      rowRef={setNodeRef}
      rowStyle={rowStyle}
    />
  );
}

export type MultiMonthTimelineProps = {
  /** Ordered month payloads (one per visible month). */
  monthsData: CalendarMonthPayload[];
  loading: boolean;
  error: string | null;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  sortableRoomIds?: string[] | null;
  onBookingClick?: (bookingId: string) => void;
};

export function MultiMonthTimeline({
  monthsData,
  loading,
  error,
  onPrevMonth,
  onNextMonth,
  sortableRoomIds,
  onBookingClick,
}: MultiMonthTimelineProps) {
  const { active } = useDndContext();

  if (loading && monthsData.length === 0) {
    return <p className="ops-muted">Loading bookings…</p>;
  }

  if (error) {
    return <p className="ops-error">{error}</p>;
  }

  if (monthsData.length === 0) {
    return null;
  }

  const merged = mergePayloads(monthsData);
  const { range: spec, bookings, blocks, rooms, markerCount, dailyRatesByRoomDay } = merged;

  const blocksByRoom = new Map<string, CalendarBlockItem[]>();
  for (const blk of blocks) {
    const list = blocksByRoom.get(blk.roomId) ?? [];
    list.push(blk);
    blocksByRoom.set(blk.roomId, list);
  }

  const hasAnyItems = bookings.length > 0 || blocks.length > 0;
  const rangeTitle = formatMultiMonthRangeTitle(monthsData.map((m) => m.month));

  const activePayload = active?.data?.current as
    | { type?: string; fromRoomId?: string | null; bookingId?: string }
    | undefined;
  const draggingUnassignedBooking =
    activePayload?.type === "booking" &&
    (activePayload?.fromRoomId == null || activePayload?.fromRoomId === "unassigned") &&
    typeof activePayload.bookingId === "string";
  const draggedBooking = draggingUnassignedBooking
    ? bookings.find((b) => b.id === activePayload?.bookingId) ?? null
    : null;
  const draggedHintSpan = draggedBooking
    ? bookingSpanInRange(draggedBooking.startDate, draggedBooking.endDate, spec)
    : null;

  function spansOverlap(
    a: { start: number; endExclusive: number },
    b: { start: number; endExclusive: number },
  ): boolean {
    return a.start < b.endExclusive && b.start < a.endExclusive;
  }

  function roomCanAcceptDraggedBooking(roomId: string): boolean {
    if (!draggedHintSpan) return false;
    const roomBookings = bookings.filter((b) => b.roomId === roomId);
    for (const booking of roomBookings) {
      const span = bookingSpanInRange(booking.startDate, booking.endDate, spec);
      if (spansOverlap(draggedHintSpan, span)) return false;
    }
    const roomBlocks = blocksByRoom.get(roomId) ?? [];
    for (const block of roomBlocks) {
      const s = block.startDate.slice(0, 10);
      const e = block.endDate.slice(0, 10);
      for (let c = draggedHintSpan.start; c < draggedHintSpan.endExclusive; c++) {
        const iso = spec.columnToIso(c);
        if (iso >= s && iso < e) return false;
      }
    }
    return true;
  }

  const dayKeys = Array.from({ length: spec.totalDayCount }, (_, i) => i + 1);
  const boundarySet = new Set(spec.monthBoundaryColumns);
  const lastVisibleIso = spec.columnToIso(spec.totalDayCount);
  const scrollMinWidth = `max(100%, ${spec.totalDayCount * 28}px)`;

  const sortIds =
    sortableRoomIds && sortableRoomIds.length > 0
      ? sortableRoomIds.map((id) => `room-order:${id}`)
      : null;

  const rates = dailyRatesByRoomDay;

  const desktopRows = rooms.map((room) => {
    const roomBookings = bookings.filter((b) => b.roomId === room.id);
    const title = room.name || room.code || room.id;
    const showHint = draggedHintSpan && roomCanAcceptDraggedBooking(room.id) ? draggedHintSpan : null;
    const common: Omit<UnifiedLaneProps, "showSortHandle" | "sortHandleProps" | "rowRef" | "rowStyle"> = {
      laneId: `unified:lane-room-${room.id}`,
      testIdSuffix: laneTestIdSuffix(room),
      title,
      roomId: room.id,
      items: roomBookings,
      blocks: blocksByRoom.get(room.id) ?? [],
      allBookings: bookings,
      spec,
      lastVisibleIso,
      dayKeys,
      hintSpan: showHint,
      dailyRatesForRoom: rates[room.id],
      monthBoundaryColumns: boundarySet,
      onBookingClick,
    };
    return sortIds ? (
      <SortableUnifiedLane key={room.id} {...common} sortableId={`room-order:${room.id}`} />
    ) : (
      <UnifiedTimelineLane key={room.id} {...common} />
    );
  });

  return (
    <div className="ops-month-grid">
      {markerCount > 0 && (
        <div className="ops-markers" role="status">
          {markerCount} sync warning(s) found.
        </div>
      )}
      {!loading && !error && !hasAnyItems && (
        <div className="ops-markers" role="status">
          No bookings or blocks found for this range. Use month navigation to view another range.
        </div>
      )}

      <div className="ops-timeline-month">
        <div className="ops-timeline-month-nav">
          <div className="ops-timeline-month-title-cluster">
            <button type="button" className="ops-btn ops-month-step" aria-label="Previous month" onClick={onPrevMonth}>
              «
            </button>
            <h2 className="ops-month-title-inline">{rangeTitle}</h2>
            <button type="button" className="ops-btn ops-month-step" aria-label="Next month" onClick={onNextMonth}>
              »
            </button>
          </div>
        </div>

        <div
          className="ops-timeline-scroll ops-timeline-scroll--multi"
          style={{ "--ops-timeline-min-width": scrollMinWidth } as CSSProperties}
        >
          <div className="ops-timeline-header">
            <div className="ops-timeline-room-label">Apartments</div>
            <div
              className="ops-timeline-days-head"
              style={{ gridTemplateColumns: `repeat(${spec.totalDayCount}, minmax(28px, 1fr))` }}
            >
              {dayKeys.map((d) => {
                const iso = spec.columnToIso(d);
                const wd = new Date(`${iso}T00:00:00.000Z`);
                const dow = new Intl.DateTimeFormat("en", { weekday: "short" }).format(wd);
                const dom = wd.getUTCDate();
                const boundary = boundarySet.has(d);
                return (
                  <div
                    key={`head-${d}`}
                    className={`ops-timeline-head-cell${boundary ? " ops-timeline-head-cell--month-start" : ""}`}
                  >
                    <span className="ops-timeline-head-dow">{dow}</span>
                    <span className="ops-timeline-head-dom">{dom}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {sortIds ? (
            <SortableContext items={sortIds} strategy={verticalListSortingStrategy}>
              {desktopRows}
            </SortableContext>
          ) : (
            desktopRows
          )}
        </div>
      </div>
    </div>
  );
}
