"use client";

import { useDroppable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import type { IsoDate } from "@stay-ops/domain";
import type { CalendarBlock, CalendarBooking, CalendarRoom } from "@/api/types";
import { ApartmentRow } from "@/ui/ApartmentRow";
import { cn } from "@/ui/cn";
import { DraggableBar } from "./DraggableBar";
import { dateAt, dayIndex, monthsBetween, type Span } from "./timeline";

/** Width of the sticky apartment column (ApartmentRow's label cell, w-52). */
export const LABEL_WIDTH = 208;
const NEUTRAL = "#5B5852";

export type DropState = { state: "free" | "busy"; guest?: string } | null;

export type CalendarGridProps = {
  span: Span;
  dayWidth: number;
  firstDay: number;
  lastDay: number;
  today: IsoDate;
  rooms: CalendarRoom[];
  bookings: CalendarBooking[];
  blocks: CalendarBlock[];
  overbooked: Set<IsoDate>;
  selectedId: string | null;
  dropStates: Map<string, DropState>;
  onOpen: (bookingId: string) => void;
};

function weekdayOf(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function DayHeader({ span, dayWidth, firstDay, lastDay, today, overbooked }: CalendarGridProps) {
  const t = useTranslations();
  const days: number[] = [];
  for (let i = Math.max(0, firstDay); i <= Math.min(lastDay, span.days - 1); i++) days.push(i);
  const months = monthsBetween(span, firstDay, lastDay);
  return (
    <div
      className="border-border bg-surface sticky top-0 z-20 flex border-b"
      style={{ width: LABEL_WIDTH + span.days * dayWidth }}
    >
      <div className="border-border bg-surface sticky left-0 z-30 flex-none border-r" style={{ width: LABEL_WIDTH }} />
      <div className="relative h-[76px] flex-1">
        {months.map((m) => (
          <div
            key={m.start}
            className="border-border absolute top-0 h-8 border-l"
            style={{ left: m.startDay * dayWidth, width: (m.endDay - m.startDay) * dayWidth }}
          >
            <span
              className="bg-surface text-sm sticky inline-block px-2 py-1 font-semibold"
              style={{ left: LABEL_WIDTH }}
            >
              {t("calendar.monthYear", {
                month: t("common.month", { month: String(Number(m.start.slice(5, 7))) }),
                year: m.start.slice(0, 4),
              })}
            </span>
          </div>
        ))}
        {days.map((i) => {
          const date = dateAt(span, i);
          const weekday = weekdayOf(date);
          const isToday = date === today;
          const isOverbooked = overbooked.has(date);
          return (
            <div
              key={date}
              className={cn(
                "border-border absolute top-8 flex h-11 flex-col items-center justify-center border-l text-xs leading-tight",
                isToday ? "bg-accent font-bold text-white" : (weekday === 0 || weekday === 6) && "bg-surface-muted",
              )}
              style={{ left: i * dayWidth, width: dayWidth }}
              title={isOverbooked ? t("calendar.overbooked") : undefined}
            >
              {dayWidth >= 80 ? <span>{t("common.weekdayShort", { day: String(weekday) })}</span> : null}
              <span>{Number(date.slice(8, 10))}</span>
              {isOverbooked ? (
                <span
                  className="bg-danger absolute bottom-0 h-1.5 w-full"
                  aria-label={t("calendar.overbooked")}
                  role="img"
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoomTrack({
  room,
  props,
  rowBookings,
  rowBlocks,
}: {
  room: CalendarRoom;
  props: CalendarGridProps;
  rowBookings: CalendarBooking[];
  rowBlocks: CalendarBlock[];
}) {
  const t = useTranslations();
  const { span, dayWidth, firstDay, lastDay, today, selectedId, onOpen } = props;
  const { setNodeRef } = useDroppable({ id: `room:${room.id}`, data: { roomId: room.id }, disabled: !room.isActive });
  const drop = props.dropStates.get(room.id) ?? null;
  const todayIndex = dayIndex(span, today);
  const visible = (start: IsoDate, end: IsoDate) => dayIndex(span, end) >= firstDay && dayIndex(span, start) <= lastDay;
  return (
    <div ref={setNodeRef}>
      <ApartmentRow
        name={room.name}
        color={room.color ?? NEUTRAL}
        capacity={room.capacity ?? 0}
        capacityLabel={() =>
          room.capacity === null ? t("common.noCapacity") : t("common.upToPeople", { count: room.capacity })
        }
        inactive={!room.isActive}
        dropState={drop?.state ?? null}
        {...(drop?.guest ? { busyGuest: drop.guest } : {})}
      >
        <div className="relative h-full" style={{ width: span.days * dayWidth }}>
          {todayIndex >= 0 && todayIndex < span.days ? (
            <div
              className="bg-accent/10 absolute inset-y-0"
              style={{ left: todayIndex * dayWidth, width: dayWidth }}
              aria-hidden="true"
            />
          ) : null}
          {rowBlocks
            .filter((b) => visible(b.start, b.end))
            .map((b) => (
              <div
                key={b.id}
                className="border-text-muted bg-surface-muted text-text-muted text-xs absolute top-4 flex h-14 items-center overflow-hidden rounded-[10px] border-2 border-dashed px-3"
                style={{
                  left: (dayIndex(span, b.start) + 0.5) * dayWidth + 2,
                  width: (dayIndex(span, b.end) - dayIndex(span, b.start)) * dayWidth - 4,
                }}
                title={b.reason ?? t("calendar.closed")}
              >
                <span className="truncate">
                  {b.reason ? t("calendar.closedReason", { reason: b.reason }) : t("calendar.closed")}
                </span>
              </div>
            ))}
          {rowBookings
            .filter((b) => visible(b.checkin, b.checkout))
            .map((b) => (
              <DraggableBar
                key={b.id}
                booking={b}
                color={room.color}
                selected={b.id === selectedId}
                onOpen={onOpen}
                className="absolute top-4"
                style={{
                  left: (dayIndex(span, b.checkin) + 0.5) * dayWidth + 2,
                  width: Math.max(
                    dayWidth - 4,
                    (dayIndex(span, b.checkout) - dayIndex(span, b.checkin)) * dayWidth - 4,
                  ),
                }}
              />
            ))}
        </div>
      </ApartmentRow>
    </div>
  );
}

/** The day header and one row per apartment; only the visible days are drawn. */
export function CalendarGrid(props: CalendarGridProps) {
  const byRoom = new Map<string, CalendarBooking[]>();
  for (const b of props.bookings) {
    if (!b.assignment) continue;
    byRoom.set(b.assignment.roomId, [...(byRoom.get(b.assignment.roomId) ?? []), b]);
  }
  return (
    <div style={{ width: LABEL_WIDTH + props.span.days * props.dayWidth }}>
      <DayHeader {...props} />
      {props.rooms.map((room) => (
        <RoomTrack
          key={room.id}
          room={room}
          props={props}
          rowBookings={byRoom.get(room.id) ?? []}
          rowBlocks={props.blocks.filter((b) => b.roomId === room.id)}
        />
      ))}
    </div>
  );
}
