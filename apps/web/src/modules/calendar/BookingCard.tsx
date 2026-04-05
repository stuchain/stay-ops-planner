"use client";

import { useDraggable } from "@dnd-kit/core";
import type { CalendarBookingItem } from "./calendarTypes";

type Props = {
  item: CalendarBookingItem;
};

export function BookingCard({ item }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `booking-${item.id}`,
    data: {
      type: "booking" as const,
      bookingId: item.id,
      assignmentId: item.assignmentId,
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

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, touchAction: "none" }}
      className={`ops-booking-card ${stateClass}`}
      data-testid={`ops-booking-card-${item.id}`}
      {...listeners}
      {...attributes}
    >
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
