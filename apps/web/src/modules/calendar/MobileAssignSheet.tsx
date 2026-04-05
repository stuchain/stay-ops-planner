"use client";

import type { CalendarBookingItem, CalendarRoom } from "./calendarTypes";

type Props = {
  open: boolean;
  booking: CalendarBookingItem | null;
  rooms: CalendarRoom[];
  onClose: () => void;
  onPickRoom: (toRoomId: string | null) => void;
};

export function MobileAssignSheet({ open, booking, rooms, onClose, onPickRoom }: Props) {
  if (!open || !booking) return null;

  return (
    <div className="ops-sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ops-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ops-sheet-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="ops-sheet-handle" aria-hidden />
        <h2 id="ops-sheet-title" className="ops-sheet-title">
          Assign stay
        </h2>
        <p className="ops-sheet-sub">
          {booking.guestName} · {booking.startDate} → {booking.endDate}
        </p>
        <div className="ops-sheet-actions">
          {booking.assignmentId && (
            <button
              type="button"
              className="ops-sheet-btn"
              onClick={() => onPickRoom(null)}
            >
              Move to unassigned
            </button>
          )}
          {rooms.map((r) => (
            <button
              key={r.id}
              type="button"
              className="ops-sheet-btn"
              onClick={() => onPickRoom(r.id)}
            >
              {r.code ?? r.name ?? r.id}
            </button>
          ))}
        </div>
        <button type="button" className="ops-sheet-btn ops-sheet-btn-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
