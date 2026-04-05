"use client";

import type { CalendarBlockItem, CalendarBookingItem, CalendarMonthPayload, CalendarRoom } from "./calendarTypes";
import { BookingCard } from "./BookingCard";
import { BlockChip } from "./BlockChip";
import { RoomLane } from "./RoomLane";

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
};

export function MonthGrid({ data, loading, error, onPrevMonth, onNextMonth }: Props) {
  if (loading && !data) {
    return <p className="ops-muted">Loading calendar…</p>;
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
        <span className="ops-muted ops-tz">{data.timezone}</span>
      </div>

      {data.markers.length > 0 && (
        <div className="ops-markers" role="status">
          {data.markers.length} import warning(s) — review sync logs.
        </div>
      )}

      <RoomLane laneId="lane-unassigned" title="Unassigned" testIdSuffix="unassigned">
        {unassignedBookings.map((b) => (
          <BookingCard key={b.id} item={b} />
        ))}
        {unassignedBookings.length === 0 && <span className="ops-muted">No unassigned stays</span>}
      </RoomLane>

      {data.rooms.map((room) => {
        const roomBookings = bookings.filter((b) => b.roomId === room.id);
        const roomBlocks = blocksByRoom.get(room.id) ?? [];
        const title = room.code ? `${room.code}${room.name ? ` — ${room.name}` : ""}` : room.name || room.id;
        return (
          <RoomLane
            key={room.id}
            laneId={`lane-room-${room.id}`}
            title={title}
            testIdSuffix={laneTestIdSuffix(room)}
          >
            {roomBlocks.map((blk) => (
              <BlockChip key={blk.id} item={blk} />
            ))}
            {roomBookings.map((b) => (
              <BookingCard key={b.id} item={b} />
            ))}
            {roomBookings.length === 0 && roomBlocks.length === 0 && (
              <span className="ops-muted">No bookings</span>
            )}
          </RoomLane>
        );
      })}
    </div>
  );
}
