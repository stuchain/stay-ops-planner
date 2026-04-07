"use client";

import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import type {
  CalendarBlockItem,
  CalendarBookingItem,
  CalendarMonthPayload,
  CalendarRoom,
} from "./calendarTypes";
import { BookingCard } from "./BookingCard";
import { BlockChip } from "./BlockChip";
import { RoomLane } from "./RoomLane";
import { bookingItemToDragPayload } from "./optimisticMove";

function laneTestIdSuffix(room: CalendarRoom): string {
  const raw = room.code?.trim() || room.id;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

type Props = {
  data: CalendarMonthPayload | null;
  loading: boolean;
  error: string | null;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onCurrentMonth?: () => void;
  onAddBlock?: () => void;
  onEditBlock?: (item: CalendarBlockItem) => void;
  isMobile?: boolean;
  onQuickAssign?: (item: CalendarBookingItem) => void;
  onOpenUnassigned?: () => void;
};

function dayOfMonthIso(iso: string): number {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.getUTCDate();
}

function toMonthSpan(
  item: CalendarBookingItem,
  month: string,
  monthDayCount: number,
): { start: number; endExclusive: number } {
  const startMonth = item.startDate.slice(0, 7);
  const endMonth = item.endDate.slice(0, 7);
  const start = startMonth === month ? Math.max(1, dayOfMonthIso(item.startDate)) : 1;
  const endExclusive =
    endMonth === month ? Math.min(monthDayCount + 1, dayOfMonthIso(item.endDate)) : monthDayCount + 1;
  return { start, endExclusive: Math.max(start + 1, endExclusive) };
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
  const sorted = [...items].sort((a, b) => {
    const sa = toMonthSpan(a, month, monthDayCount).start;
    const sb = toMonthSpan(b, month, monthDayCount).start;
    if (sa !== sb) return sa - sb;
    return (
      toMonthSpan(a, month, monthDayCount).endExclusive -
      toMonthSpan(b, month, monthDayCount).endExclusive
    );
  });
  const laneEnds: number[] = [];
  const out: Array<{ item: CalendarBookingItem; lane: number }> = [];
  for (const item of sorted) {
    const { start, endExclusive } = toMonthSpan(item, month, monthDayCount);
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endExclusive);
    } else {
      laneEnds[lane] = endExclusive;
    }
    out.push({ item, lane });
  }
  return out;
}

type TimelineLaneProps = {
  laneId: string;
  testIdSuffix: string;
  title: string;
  items: CalendarBookingItem[];
  month: string;
  monthDayCount: number;
  dayKeys: number[];
  hintSpan: { start: number; endExclusive: number } | null;
};

function TimelineLane({
  laneId,
  testIdSuffix,
  title,
  items,
  month,
  monthDayCount,
  dayKeys,
  hintSpan,
}: TimelineLaneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: laneId });
  const laidOut = layoutRows(items, month, monthDayCount);
  const maxLane = laidOut.reduce((m, x) => Math.max(m, x.lane), 0);
  const minHeight = Math.max(36, (maxLane + 1) * 30);
  return (
    <div className={`ops-timeline-row${isOver ? " ops-room-lane-over" : ""}`} data-testid={`ops-room-lane-${testIdSuffix}`}>
      <div className="ops-timeline-room-label">{title}</div>
      <div ref={setNodeRef} className="ops-timeline-track" style={{ minHeight }}>
        <div className="ops-timeline-day-grid" style={{ gridTemplateColumns: `repeat(${monthDayCount}, minmax(26px, 1fr))` }}>
          {dayKeys.map((d) => (
            <div key={`${laneId}-${d}`} className="ops-timeline-day-cell" />
          ))}
        </div>
        <div className="ops-timeline-bars" style={{ gridTemplateColumns: `repeat(${monthDayCount}, minmax(26px, 1fr))` }}>
          {hintSpan && (
            <div
              className="ops-timeline-assign-hint"
              style={{ gridColumn: `${hintSpan.start} / ${hintSpan.endExclusive}`, gridRow: "1" }}
            >
              Drop to assign
            </div>
          )}
          {laidOut.map(({ item, lane }) => {
            const { start, endExclusive } = toMonthSpan(item, month, monthDayCount);
            return (
              <TimelineBookingBar
                key={item.id}
                item={item}
                lane={lane}
                start={start}
                endExclusive={endExclusive}
                nights={nightsLabel(item)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function MonthGrid({
  data,
  loading,
  error,
  onPrevMonth,
  onNextMonth,
  onCurrentMonth,
  onAddBlock,
  onEditBlock,
  isMobile,
  onQuickAssign,
  onOpenUnassigned,
}: Props) {
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

  const unassignedBookings = bookings.filter((b) => b.roomId === null);
  const hasAnyItems = bookings.length > 0 || blocks.length > 0;
  const monthParts = data.month.split("-").map((p) => Number(p));
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
    ? toMonthSpan(draggedBooking, data.month, monthDayCount)
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
      const span = toMonthSpan(booking, data.month, monthDayCount);
      if (spansOverlap(draggedHintSpan, span)) return false;
    }
    const roomBlocks = blocksByRoom.get(roomId) ?? [];
    for (const block of roomBlocks) {
      const blockStartMonth = block.startDate.slice(0, 7);
      const blockEndMonth = block.endDate.slice(0, 7);
      const blockSpan = {
        start: blockStartMonth === data.month ? Math.max(1, dayOfMonthIso(block.startDate)) : 1,
        endExclusive:
          blockEndMonth === data.month
            ? Math.min(monthDayCount + 1, dayOfMonthIso(block.endDate))
            : monthDayCount + 1,
      };
      if (spansOverlap(draggedHintSpan, blockSpan)) return false;
    }
    return true;
  }
  const blocksByRoom = new Map<string, CalendarBlockItem[]>();
  for (const blk of blocks) {
    const list = blocksByRoom.get(blk.roomId) ?? [];
    list.push(blk);
    blocksByRoom.set(blk.roomId, list);
  }

  return (
    <div className="ops-month-grid">
      <div className="ops-month-toolbar">
        <button type="button" className="ops-btn" onClick={onPrevMonth}>
          Previous
        </button>
        <h2 className="ops-month-title">{data.month}</h2>
        <button type="button" className="ops-btn" onClick={onNextMonth}>
          Next
        </button>
        {onCurrentMonth && (
          <button type="button" className="ops-btn" onClick={onCurrentMonth}>
            Today
          </button>
        )}
        {onOpenUnassigned && (
          <button type="button" className="ops-btn" onClick={onOpenUnassigned}>
            More unassigned bookings
          </button>
        )}
        {onAddBlock && (
          <button type="button" className="ops-btn ops-btn-primary" onClick={onAddBlock}>
            Block dates
          </button>
        )}
        <span className="ops-muted ops-tz">{data.timezone}</span>
      </div>

      {data.markers.length > 0 && (
        <div className="ops-markers" role="status">
          {data.markers.length} sync warning(s) found.
        </div>
      )}
      {!loading && !error && !hasAnyItems && (
        <div className="ops-markers" role="status">
          No bookings or blocks found for this month. Try Previous/Next to view another month.
        </div>
      )}

      {!isMobile && (
        <div className="ops-timeline-month">
          <div className="ops-timeline-header">
            <div className="ops-timeline-room-label">Apartments</div>
            <div className="ops-timeline-days-head" style={{ gridTemplateColumns: `repeat(${monthDayCount}, minmax(26px, 1fr))` }}>
              {dayKeys.map((d) => (
                <div key={`head-${d}`} className="ops-timeline-head-cell">
                  {d}
                </div>
              ))}
            </div>
          </div>
          <TimelineLane
            laneId="lane-unassigned"
            testIdSuffix="unassigned"
            title="Needs assignment"
            items={unassignedBookings}
            month={data.month}
            monthDayCount={monthDayCount}
            dayKeys={dayKeys}
            hintSpan={null}
          />
          {data.rooms.map((room) => {
            const roomBookings = bookings.filter((b) => b.roomId === room.id);
            const title = room.name || room.code || room.id;
            const showHint = draggedHintSpan && roomCanAcceptDraggedBooking(room.id) ? draggedHintSpan : null;
            return (
              <TimelineLane
                key={room.id}
                laneId={`lane-room-${room.id}`}
                testIdSuffix={laneTestIdSuffix(room)}
                title={title}
                items={roomBookings}
                month={data.month}
                monthDayCount={monthDayCount}
                dayKeys={dayKeys}
                hintSpan={showHint}
              />
            );
          })}
        </div>
      )}

      {isMobile && (
        <>
          <RoomLane laneId="lane-unassigned" title="Needs assignment" testIdSuffix="unassigned">
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
                laneId={`lane-room-${room.id}`}
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

function TimelineBookingBar({
  item,
  start,
  endExclusive,
  lane,
  nights,
}: {
  item: CalendarBookingItem;
  start: number;
  endExclusive: number;
  lane: number;
  nights: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `booking-${item.id}`,
    data: bookingItemToDragPayload(item),
  });
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.85 : 1,
      }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      className="ops-timeline-booking"
      data-testid={`ops-booking-card-${item.id}`}
      title={item.guestName}
      style={{
        ...style,
        gridColumn: `${start} / ${endExclusive}`,
        gridRow: `${lane + 1}`,
      }}
      {...listeners}
      {...attributes}
    >
      <span className="ops-timeline-booking-name">{item.guestName}</span>
      <span className="ops-timeline-booking-meta">{nights}</span>
    </div>
  );
}
