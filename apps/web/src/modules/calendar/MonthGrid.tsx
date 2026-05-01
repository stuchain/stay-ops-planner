"use client";

import { type CSSProperties } from "react";
import { useDndContext, useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  CalendarBlockItem,
  CalendarBookingItem,
  CalendarMonthPayload,
  CalendarRoom,
} from "./calendarTypes";
import { BookingCard } from "./BookingCard";
import { BlockChip } from "./BlockChip";
import { RoomLane } from "./RoomLane";
import {
  bookingSpanFromStayDates,
  hasNextCheckinOnCheckoutDay,
  hasPriorCheckoutOnFirstNightDay,
  isStayCheckoutAfterVisibleLastDay,
  type BookingSpanInMonth,
} from "./monthSpan";
import { ChannelLogo } from "@/modules/bookings/ChannelLogo";
import { SyncWarningsInfo } from "./SyncWarningsInfo";
import { TimelineBookingBar } from "./TimelineBookingBar";

function laneTestIdSuffix(room: CalendarRoom): string {
  const raw = room.code?.trim() || room.id;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export type MonthGridProps = {
  data: CalendarMonthPayload | null;
  loading: boolean;
  error: string | null;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onEditBlock?: (item: CalendarBlockItem) => void;
  isMobile?: boolean;
  onQuickAssign?: (item: CalendarBookingItem) => void;
  laneScope?: string;
  showNavigation?: boolean;
  /** When set, room rows are reorderable (desktop). */
  sortableRoomIds?: string[] | null;
  onBookingClick?: (bookingId: string) => void;
  onMarkerBookingClick?: (bookingId: string) => void;
};

function dayOfMonthIso(iso: string): number {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.getUTCDate();
}

/** Night columns [start,endExclusive) plus layout/checkout fields — see `bookingSpanFromStayDates`. */
export function toMonthSpan(
  item: CalendarBookingItem,
  month: string,
  monthDayCount: number,
): BookingSpanInMonth {
  return bookingSpanFromStayDates(item.startDate, item.endDate, month, monthDayCount);
}

function nightsLabel(item: CalendarBookingItem): string {
  const s = new Date(`${item.startDate}T00:00:00.000Z`).getTime();
  const e = new Date(`${item.endDate}T00:00:00.000Z`).getTime();
  const n = Math.max(1, Math.round((e - s) / 86_400_000));
  return `${n} night${n === 1 ? "" : "s"}`;
}

function layoutRows(
  items: CalendarBookingItem[],
  month: string,
  monthDayCount: number,
): Array<{ item: CalendarBookingItem; lane: number }> {
  type LaneState = {
    end: number;
    lastSpan: BookingSpanInMonth;
  };
  function isCheckinCutIn(item: CalendarBookingItem, span: BookingSpanInMonth): boolean {
    return (
      item.startDate.slice(0, 7) === month &&
      span.endExclusive > span.start &&
      dayOfMonthIso(item.startDate) === span.start
    );
  }
  function canReuseMateLane(
    lane: LaneState,
    span: BookingSpanInMonth,
    mateCandidate: boolean,
  ): boolean {
    if (!mateCandidate) return false;
    if (span.endExclusive <= span.start) return false;
    if (lane.lastSpan.checkoutDayInMonth !== span.start) return false;
    // Only reuse when the lane "overlap" is from checkout nib width, not occupied nights.
    if (lane.lastSpan.endExclusive > span.start) return false;
    return lane.end === span.barStart + 1;
  }
  const sorted = [...items].sort((a, b) => {
    const A = toMonthSpan(a, month, monthDayCount);
    const B = toMonthSpan(b, month, monthDayCount);
    if (A.barStart !== B.barStart) return A.barStart - B.barStart;
    return A.layoutEndExclusive - B.layoutEndExclusive;
  });
  const lanes: LaneState[] = [];
  const out: Array<{ item: CalendarBookingItem; lane: number }> = [];
  for (const item of sorted) {
    const span = toMonthSpan(item, month, monthDayCount);
    const mateCandidate =
      isCheckinCutIn(item, span) &&
      hasPriorCheckoutOnFirstNightDay(items, item.id, month, monthDayCount, span.start);
    let lane = lanes.findIndex(
      (laneState) =>
        laneState.end <= span.barStart || canReuseMateLane(laneState, span, mateCandidate),
    );
    if (lane === -1) {
      lane = lanes.length;
      lanes.push({ end: span.layoutEndExclusive, lastSpan: span });
    } else {
      lanes[lane] = { end: span.layoutEndExclusive, lastSpan: span };
    }
    out.push({ item, lane });
  }
  return out;
}

function fmtDayPrice(amountCents: number, currency: string): string {
  const v = amountCents / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(0)} ${currency}`;
}

function isoDateInMonth(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

function dayOccupiedByBooking(
  day: number,
  roomId: string,
  bookings: CalendarBookingItem[],
  month: string,
  monthDayCount: number,
): boolean {
  for (const b of bookings) {
    if (b.roomId !== roomId) continue;
    const { start, endExclusive } = toMonthSpan(b, month, monthDayCount);
    if (day >= start && day < endExclusive) return true;
  }
  return false;
}

function dayOccupiedByBlock(
  day: number,
  roomId: string,
  blocks: CalendarBlockItem[],
  month: string,
  monthDayCount: number,
): boolean {
  for (const blk of blocks) {
    if (blk.roomId !== roomId) continue;
    const sm = blk.startDate.slice(0, 7);
    const em = blk.endDate.slice(0, 7);
    const start = sm === month ? Math.max(1, dayOfMonthIso(blk.startDate)) : 1;
    const endExclusive =
      em === month ? Math.min(monthDayCount + 1, dayOfMonthIso(blk.endDate)) : monthDayCount + 1;
    if (day >= start && day < endExclusive) return true;
  }
  return false;
}

type TimelineLaneProps = {
  laneId: string;
  testIdSuffix: string;
  title: string;
  roomId: string;
  items: CalendarBookingItem[];
  blocks: CalendarBlockItem[];
  allBookings: CalendarBookingItem[];
  month: string;
  monthDayCount: number;
  /** Last calendar day (YYYY-MM-DD) shown in this grid. */
  lastVisibleIso: string;
  dayKeys: number[];
  hintSpan: { start: number; endExclusive: number } | null;
  dailyRatesForRoom: Record<string, { amountCents: number; currency: string }> | undefined;
  showSortHandle?: boolean;
  sortHandleProps?: Record<string, unknown>;
  rowRef?: (node: HTMLDivElement | null) => void;
  rowStyle?: CSSProperties;
  onBookingClick?: (bookingId: string) => void;
};

function TimelineLane({
  laneId,
  testIdSuffix,
  title,
  roomId,
  items,
  blocks,
  allBookings,
  month,
  monthDayCount,
  lastVisibleIso,
  dayKeys,
  hintSpan,
  dailyRatesForRoom,
  showSortHandle,
  sortHandleProps,
  rowRef,
  rowStyle,
  onBookingClick,
}: TimelineLaneProps) {
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: laneId });
  const laidOut = layoutRows(items, month, monthDayCount);
  const maxLane = laidOut.reduce((m, x) => Math.max(m, x.lane), 0);
  const minHeight = Math.max(36, (maxLane + 1) * 30);

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
            const isoDay = isoDateInMonth(month, d);
            const rate = dailyRatesForRoom?.[isoDay];
            const occupied =
              dayOccupiedByBooking(d, roomId, allBookings, month, monthDayCount) ||
              dayOccupiedByBlock(d, roomId, blocks, month, monthDayCount);
            const showPrice = rate && !occupied;
            return (
              <div key={`${laneId}-${d}`} className="ops-timeline-day-cell">
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
            const span = toMonthSpan(item, month, monthDayCount);
            const checkinCutIn =
              item.startDate.slice(0, 7) === month &&
              span.endExclusive > span.start &&
              dayOfMonthIso(item.startDate) === span.start;
            const checkinMatePriorCheckout = hasPriorCheckoutOnFirstNightDay(
              items,
              item.id,
              month,
              monthDayCount,
              span.start,
            );
            const turnoverOutgoing =
              span.checkoutDayInMonth != null &&
              hasNextCheckinOnCheckoutDay(
                items,
                item.id,
                month,
                monthDayCount,
                span.checkoutDayInMonth,
              );
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

function SortableTimelineLane(props: Omit<TimelineLaneProps, "showSortHandle" | "sortHandleProps" | "rowRef" | "rowStyle"> & {
  sortableId: string;
}) {
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
    <TimelineLane
      {...rest}
      showSortHandle
      sortHandleProps={{ ...attributes, ...listeners }}
      rowRef={setNodeRef}
      rowStyle={rowStyle}
    />
  );
}

export function MonthGrid({
  data,
  loading,
  error,
  onPrevMonth,
  onNextMonth,
  onEditBlock,
  isMobile,
  onQuickAssign,
  laneScope,
  showNavigation = true,
  sortableRoomIds,
  onBookingClick,
  onMarkerBookingClick,
}: MonthGridProps) {
  const { active } = useDndContext();
  if (loading && !data) {
    return <p className="ops-muted">Loading bookings…</p>;
  }

  if (error) {
    return <p className="ops-error">{error}</p>;
  }

  if (!data) {
    return null;
  }

  const bookings = data.items.filter((i): i is CalendarBookingItem => i.kind === "booking");
  const blocks = data.items.filter((i): i is CalendarBlockItem => i.kind === "block");

  const blocksByRoom = new Map<string, CalendarBlockItem[]>();
  for (const blk of blocks) {
    const list = blocksByRoom.get(blk.roomId) ?? [];
    list.push(blk);
    blocksByRoom.set(blk.roomId, list);
  }

  const unassignedBookings = bookings.filter((b) => b.roomId === null);
  const hasAnyItems = bookings.length > 0 || blocks.length > 0;
  const monthValue = data.month;
  const monthParts = monthValue.split("-").map((p) => Number(p));
  const monthYear = monthParts[0] ?? 1970;
  const monthNumber = monthParts[1] ?? 1;
  const monthDayCount = new Date(monthYear, monthNumber, 0).getDate();
  const dayKeys = Array.from({ length: monthDayCount }, (_, i) => i + 1);
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
    ? toMonthSpan(draggedBooking, monthValue, monthDayCount)
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
      const span = toMonthSpan(booking, monthValue, monthDayCount);
      if (spansOverlap(draggedHintSpan, span)) return false;
    }
    const roomBlocks = blocksByRoom.get(roomId) ?? [];
    for (const block of roomBlocks) {
      const blockStartMonth = block.startDate.slice(0, 7);
      const blockEndMonth = block.endDate.slice(0, 7);
      const blockSpan = {
        start: blockStartMonth === monthValue ? Math.max(1, dayOfMonthIso(block.startDate)) : 1,
        endExclusive:
          blockEndMonth === monthValue
            ? Math.min(monthDayCount + 1, dayOfMonthIso(block.endDate))
            : monthDayCount + 1,
      };
      if (spansOverlap(draggedHintSpan, blockSpan)) return false;
    }
    return true;
  }

  function scopedLaneId(id: string): string {
    return laneScope ? `${laneScope}:${id}` : id;
  }

  function formatMonthTitle(ym: string): string {
    const [yRaw, mRaw] = ym.split("-");
    const y = Number(yRaw);
    const m = Number(mRaw);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return ym;
    return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(
      new Date(Date.UTC(y, m - 1, 1)),
    );
  }

  const rates = data.dailyRatesByRoomDay ?? {};
  const sortIds =
    sortableRoomIds && sortableRoomIds.length > 0
      ? sortableRoomIds.map((id) => `room-order:${id}`)
      : null;

  const desktopRows = data.rooms.map((room) => {
    const roomBookings = bookings.filter((b) => b.roomId === room.id);
    const title = room.name || room.code || room.id;
    const showHint = draggedHintSpan && roomCanAcceptDraggedBooking(room.id) ? draggedHintSpan : null;
    const common = {
      laneId: scopedLaneId(`lane-room-${room.id}`),
      testIdSuffix: laneTestIdSuffix(room),
      title,
      roomId: room.id,
      items: roomBookings,
      blocks: blocksByRoom.get(room.id) ?? [],
      allBookings: bookings,
      month: data.month,
      monthDayCount,
      lastVisibleIso: isoDateInMonth(data.month, monthDayCount),
      dayKeys,
      hintSpan: showHint,
      dailyRatesForRoom: rates[room.id],
      onBookingClick,
    };
    return sortIds ? (
      <SortableTimelineLane key={room.id} {...common} sortableId={`room-order:${room.id}`} />
    ) : (
      <TimelineLane key={room.id} {...common} />
    );
  });

  return (
    <div className="ops-month-grid">
      {data.markers.length > 0 && (
        <SyncWarningsInfo markers={data.markers} onOpenBooking={onMarkerBookingClick} />
      )}
      {!loading && !error && !hasAnyItems && (
        <div className="ops-markers" role="status">
          No bookings or blocks found for this month. Use month navigation to view another month.
        </div>
      )}

      {!isMobile && (
        <div className="ops-timeline-month">
          {showNavigation ? (
            <div className="ops-timeline-month-nav">
              <div className="ops-timeline-month-title-cluster">
                <button type="button" className="ops-btn ops-month-step" aria-label="Previous month" onClick={onPrevMonth}>
                  «
                </button>
                <h2 className="ops-month-title-inline">{formatMonthTitle(data.month)}</h2>
                <button type="button" className="ops-btn ops-month-step" aria-label="Next month" onClick={onNextMonth}>
                  »
                </button>
              </div>
            </div>
          ) : null}

          <div className="ops-timeline-scroll">
            <div className="ops-timeline-header">
              <div className="ops-timeline-room-label">Apartments</div>
              <div
                className="ops-timeline-days-head"
                style={{ gridTemplateColumns: `repeat(${monthDayCount}, minmax(28px, 1fr))` }}
              >
                {dayKeys.map((d) => {
                  const wd = new Date(Date.UTC(monthYear, monthNumber - 1, d));
                  const dow = new Intl.DateTimeFormat("en", { weekday: "short" }).format(wd);
                  return (
                    <div key={`head-${d}`} className="ops-timeline-head-cell">
                      <span className="ops-timeline-head-dow">{dow}</span>
                      <span className="ops-timeline-head-dom">{d}</span>
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
      )}

      {isMobile && (
        <>
          <RoomLane laneId={scopedLaneId("lane-unassigned")} title="Needs assignment" testIdSuffix="unassigned">
            {unassignedBookings.map((b) => (
              <BookingCard
                key={b.id}
                item={b}
                isMobile
                onQuickAssign={onQuickAssign ? () => onQuickAssign(b) : undefined}
              />
            ))}
            {unassignedBookings.length === 0 && <span className="ops-muted">No unassigned bookings</span>}
          </RoomLane>

          {data.rooms.map((room) => {
            const roomBookings = bookings.filter((b) => b.roomId === room.id);
            const roomBlocks = blocksByRoom.get(room.id) ?? [];
            const title = room.name || room.code || room.id;
            return (
              <RoomLane
                key={room.id}
                laneId={scopedLaneId(`lane-room-${room.id}`)}
                title={title}
                testIdSuffix={laneTestIdSuffix(room)}
              >
                {roomBlocks.map((blk) => (
                  <BlockChip key={blk.id} item={blk} onEdit={onEditBlock} />
                ))}
                {roomBookings.map((b) => (
                  <BookingCard
                    key={b.id}
                    item={b}
                    isMobile
                    onQuickAssign={onQuickAssign ? () => onQuickAssign(b) : undefined}
                  />
                ))}
                {roomBookings.length === 0 && roomBlocks.length === 0 && (
                  <span className="ops-muted">No bookings</span>
                )}
              </RoomLane>
            );
          })}
        </>
      )}
    </div>
  );
}
