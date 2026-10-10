"use client";

import { useDraggable } from "@dnd-kit/core";
import type { CalendarBookingItem } from "./calendarTypes";
import { isPendingBooking } from "@/modules/bookings/bookingStatusLabel";
import { ChannelLogo } from "@/modules/bookings/ChannelLogo";

type Props = {
  item: CalendarBookingItem;
  isMobile?: boolean | undefined;
  onQuickAssign?: (() => void) | undefined;
  /** Distinguishes the same booking drawn in several grids (e.g. one per month on phones). */
  dragScope?: string | undefined;
};

export function BookingCard({ item, isMobile, onQuickAssign, dragScope }: Props) {
  const pending = isPendingBooking(item.status);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragScope ? `booking-${dragScope}-${item.id}` : `booking-${item.id}`,
    disabled: pending,
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
  const stateBits = [unassigned && "unassigned", needsRe && "needs reassignment"].filter(Boolean).join(", ");
  const dragLabel = `Booking ${item.guestName}, ${item.startDate} to ${item.endDate}${stateBits ? `, ${stateBits}` : ""}`;
  const channelClass =
    item.channel === "airbnb"
      ? "ops-booking-channel-airbnb"
      : item.channel === "booking"
        ? "ops-booking-channel-booking"
        : "ops-booking-channel-direct";

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, ...(pending ? { opacity: 0.5 } : {}), touchAction: isMobile ? "manipulation" : "none" }}
      className={`ops-booking-card ${stateClass} ${channelClass}`}
      data-testid={`ops-booking-card-${item.id}`}
      aria-label={isMobile ? undefined : dragLabel}
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
      <div className="ops-booking-card-title ops-name-with-logo">
        <ChannelLogo channel={item.channel} className="ops-channel-logo" />
        <span>{item.guestName}</span>
      </div>
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
