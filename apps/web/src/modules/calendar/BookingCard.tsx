"use client";

import { useDraggable } from "@dnd-kit/core";
import type { CalendarBookingItem } from "./calendarTypes";

type Props = {
  item: CalendarBookingItem;
  isMobile?: boolean;
  onQuickAssign?: () => void;
};

export function BookingCard({ item, isMobile, onQuickAssign }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `booking-${item.id}`,
    data: {
      type: "booking" as const,
      bookingId: item.id,
      assignmentId: item.assignmentId,
      assignmentVersion: item.assignmentVersion,
      fromRoomId: item.roomId,
    },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.85 : 1,
      }
    : undefined;

  const unassigned = item.flags.includes("unassigned");
  const needsRe = item.flags.includes("needs_reassignment");
  const stateClass = unassigned ? "ops-card-unassigned" : needsRe ? "ops-card-warning" : "ops-card-normal";
  const channelClass =
    item.channel === "airbnb"
      ? "ops-booking-channel-airbnb"
      : item.channel === "booking"
        ? "ops-booking-channel-booking"
        : "ops-booking-channel-direct";

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, touchAction: isMobile ? "manipulation" : "none" }}
      className={`ops-booking-card ${stateClass} ${channelClass}`}
      data-testid={`ops-booking-card-${item.id}`}
      {...(isMobile ? {} : listeners)}
      {...attributes}
    >
      {isMobile && onQuickAssign && (
        <button
          type="button"
          className="ops-assign-quick"
          data-testid={`ops-assign-quick-${item.id}`}
          onClick={(ev) => {
            ev.stopPropagation();
            onQuickAssign();
          }}
        >
          Assign…
        </button>
      )}
      <div className="ops-booking-card-title">{item.guestName}</div>
      <div className="ops-booking-card-dates">
        {item.startDate} → {item.endDate}
      </div>
      {(unassigned || needsRe) && (
        <div className="ops-booking-card-badges">
          {unassigned && <span className="ops-badge">Unassigned</span>}
          {needsRe && <span className="ops-badge ops-badge-warn">Needs reassignment</span>}
        </div>
      )}
    </div>
  );
}
