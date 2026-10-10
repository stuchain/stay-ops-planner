"use client";

import { useDraggable } from "@dnd-kit/core";
import { motion as m, useReducedMotion, type MotionStyle } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import type { CalendarBooking } from "@/api/types";
import { BookingBar } from "@/ui/BookingBar";
import { formatMoney, type UiLocale } from "@/ui/format";
import { motion } from "@/ui/tokens";

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
  const tCalendar = useTranslations("calendar");
  const locale = useLocale() as UiLocale;
  const pending = booking.status === "pending";
  const priceDetail =
    booking.nightlyCents === undefined
      ? undefined
      : tCalendar("perNight", { price: formatMoney(booking.nightlyCents, locale) });
  // The bar glides to its new row (shared layoutId across rows); off when the person asks for less motion.
  const reduceMotion = useReducedMotion();
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: `booking:${booking.id}`,
    data: { bookingId: booking.id },
    disabled: pending,
  });
  // Dragging is a mouse shortcut. Keyboard users open the panel with Enter or Space and
  // choose the apartment there, so dnd-kit's keyboard attributes are not used.
  return (
    <m.div
      ref={setNodeRef}
      {...listeners}
      {...(style ? { style: style as MotionStyle } : {})}
      className={className}
      {...(reduceMotion
        ? {}
        : {
            layout: "position" as const,
            layoutId: `bar:${booking.id}`,
            transition: { duration: motion.layoutMs / 1000, ease: [0.2, 0, 0, 1] as const },
          })}
    >
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
        detail={priceDetail}
        className="w-full"
        onClick={() => onOpen(booking.id)}
      />
    </m.div>
  );
}
