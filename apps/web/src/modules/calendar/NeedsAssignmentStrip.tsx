"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { ChannelLogo } from "@/modules/bookings/ChannelLogo";
import { bookingStatusLabel, isPendingBooking } from "@/modules/bookings/bookingStatusLabel";
import type { BookingDragPayload } from "./optimisticMove";

export type OverviewUnassignedBooking = {
  bookingId: string;
  guestName: string;
  guestTotal: number | null;
  guestAdults: number | null;
  guestChildren: number | null;
  guestInfants: number | null;
  channel: "airbnb" | "booking" | "direct";
  checkinDate: string;
  checkoutDate: string;
  status: string;
};

export function NeedsAssignmentDragCard({
  booking,
  roomValue,
  rooms,
  assigning,
  onRoomChange,
  onAssign,
}: {
  booking: OverviewUnassignedBooking;
  roomValue: string;
  rooms: Array<{ id: string; label: string; maxGuests?: number | null }>;
  assigning: boolean;
  onRoomChange: (roomId: string) => void;
  onAssign: () => void;
}) {
  const pending = isPendingBooking(booking.status);
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({
    id: `needs-booking-${booking.bookingId}`,
    disabled: pending,
    data: {
      type: "booking",
      bookingId: booking.bookingId,
      assignmentId: null,
      assignmentVersion: null,
      fromRoomId: null,
    } satisfies BookingDragPayload,
  });

  const dragStyle = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const channelClass =
    booking.channel === "airbnb"
      ? "ops-booking-channel-airbnb"
      : booking.channel === "booking"
        ? "ops-booking-channel-booking"
        : "ops-booking-channel-direct";

  return (
    <article
      ref={setNodeRef}
      className={`ops-needs-card ${channelClass}`}
      data-pending={pending ? "true" : undefined}
      style={{
        ...dragStyle,
        opacity: pending ? 0.5 : isDragging ? 0.85 : 1,
      }}
    >
      <button
        type="button"
        className="ops-needs-drag-handle"
        title="Drag to an apartment row to assign"
        aria-label={`Drag booking ${booking.guestName}`}
        disabled={pending}
        {...(pending ? {} : listeners)}
        {...(pending ? {} : attributes)}
      >
        Drag
      </button>
      <strong className="ops-name-with-logo">
        <ChannelLogo channel={booking.channel} className="ops-channel-logo" />
        <span>{booking.guestName}</span>
      </strong>
      {pending ? <div className="ops-muted">{bookingStatusLabel(booking.status)}</div> : null}
      <div className="ops-needs-dates">
        {booking.checkinDate} → {booking.checkoutDate}
      </div>
      <div className="ops-needs-actions">
        <select
          className="ops-input"
          value={roomValue}
          onChange={(ev) => onRoomChange(ev.target.value)}
          aria-label={`Apartment for booking ${booking.bookingId}`}
          disabled={pending}
        >
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ops-btn ops-btn-primary"
          disabled={pending || assigning || rooms.length === 0}
          onClick={onAssign}
        >
          {assigning ? "Assigning..." : "Assign"}
        </button>
      </div>
    </article>
  );
}

export function NeedsAssignmentDropZone({
  laneId,
  children,
}: {
  laneId: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: laneId });
  return (
    <div ref={setNodeRef} className={`ops-needs-cells${isOver ? " ops-needs-cells-over" : ""}`}>
      {children}
    </div>
  );
}
