"use client";

import { useDraggable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import type { CalendarBooking } from "@/api/types";
import { BookingBar } from "@/ui/BookingBar";

const NEUTRAL = "#5B5852";

export type DraggableBarProps = {
  booking: CalendarBooking;
  color: string | null;
  selected: boolean;
  needsRoom?: boolean;
  style?: CSSProperties;
  className?: string;
  onOpen: (bookingId: string) => void;
};

/** A booking bar that opens the panel on click and can be dragged onto an apartment row. */
export function DraggableBar({
  booking,
  color,
  selected,
  needsRoom = false,
  style,
  className,
  onOpen,
}: DraggableBarProps) {
  const t = useTranslations("common");
  const pending = booking.status === "pending";
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: `booking:${booking.id}`,
    data: { bookingId: booking.id },
    disabled: pending,
  });
  // Dragging is a mouse shortcut. Keyboard users open the panel with Enter or Space and
  // choose the apartment there, so dnd-kit's keyboard attributes are not used.
  return (
    <div ref={setNodeRef} {...listeners} style={style} className={className}>
      <BookingBar
        guest={booking.guestName ?? t("noName")}
        checkin={booking.checkin}
        checkout={booking.checkout}
        channel={booking.channel}
        color={color ?? NEUTRAL}
        selected={selected}
        dragging={isDragging}
        pending={pending}
        needsRoom={needsRoom && !pending}
        className="w-full"
        onClick={() => onOpen(booking.id)}
      />
    </div>
  );
}
