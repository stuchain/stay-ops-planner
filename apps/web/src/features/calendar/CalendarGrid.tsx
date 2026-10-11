"use client";

import { useDroppable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { memo, useMemo, useSyncExternalStore } from "react";
import type { IsoDate } from "@stay-ops/domain";
import type { CalendarBlock, CalendarBooking, CalendarRoom } from "@/api/types";
import { ApartmentRow } from "@/ui/ApartmentRow";
import { cn } from "@/ui/cn";
import { DraggableBar } from "./DraggableBar";
import { dateAt, dayIndex, monthsBetween, type DrawnDaysStore, type Span } from "./timeline";

/** Width of the sticky apartment column (ApartmentRow's label cell, w-52). */
export const LABEL_WIDTH = 208;
const NEUTRAL = "#5B5852";

export type DropState = { state: "free" | "busy"; guest?: string } | null;

const EMPTY: CalendarBooking[] = [];
const EMPTY_BLOCKS: CalendarBlock[] = [];

export type CalendarGridProps = {
  span: Span;
  dayWidth: number;
  /** The day columns to draw around the visible part; only the day header and past row follow it. */
  drawn: DrawnDaysStore;
  today: IsoDate;
  rooms: CalendarRoom[];
  bookings: CalendarBooking[];
  blocks: CalendarBlock[];
  overbooked: Set<IsoDate>;
  selectedId: string | null;
  dropStates: Map<string, DropState>;
  /** "Τακτοποίησε τον μήνα" preview: booking id to the apartment it would go to. */
  proposed?: Map<string, string>;
  onOpen: (bookingId: string) => void;
};

function weekdayOf(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function DayHeader({
  span,
  dayWidth,
  today,
  overbooked,
  drawn,
}: Pick<CalendarGridProps, "span" | "dayWidth" | "today" | "overbooked"> & { drawn: DrawnDaysStore }) {
  const t = useTranslations();
  const { firstDay, lastDay } = useSyncExternalStore(drawn.subscribe, drawn.get, drawn.get);
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

type RoomTrackProps = {
  room: CalendarRoom;
  span: Span;
  dayWidth: number;
  today: IsoDate;
  selectedId: string | null;
  drop: DropState;
  rowBookings: CalendarBooking[];
  rowBlocks: CalendarBlock[];
  rowProposed: CalendarBooking[];
  onOpen: (bookingId: string) => void;
};

/** One apartment row with all its loaded bars; does not depend on the scroll position, so scrolling never redraws it. */
const RoomTrack = memo(function RoomTrack({
  room,
  span,
  dayWidth,
  today,
  selectedId,
  drop,
  rowBookings,
  rowBlocks,
  rowProposed,
  onOpen,
}: RoomTrackProps) {
  const t = useTranslations();
  const { setNodeRef } = useDroppable({ id: `room:${room.id}`, data: { roomId: room.id }, disabled: !room.isActive });
  const todayIndex = dayIndex(span, today);
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
          {rowBlocks.map((b) => (
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
          {/* Every loaded bar stays mounted: adding and removing bars while scrolling made drag-and-drop
              redraw all of them, which is what made scrolling stutter. Only the day header follows the scroll. */}
          {rowBookings.map((b) => (
            <DraggableBar
              key={b.id}
              booking={b}
              color={room.color}
              selected={b.id === selectedId}
              onOpen={onOpen}
              className="absolute top-4"
              style={{
                left: (dayIndex(span, b.checkin) + 0.5) * dayWidth + 2,
                width: Math.max(dayWidth - 4, (dayIndex(span, b.checkout) - dayIndex(span, b.checkin)) * dayWidth - 4),
              }}
            />
          ))}
          {rowProposed.map((b) => {
            const label = t("calendar.proposed", { guest: b.guestName ?? t("common.noName") });
            return (
              <button
                key={b.id}
                type="button"
                data-testid="proposed-bar"
                onClick={() => onOpen(b.id)}
                aria-label={label}
                title={label}
                className="border-accent bg-accent-soft text-accent text-sm absolute top-4 flex h-14 items-center overflow-hidden rounded-[10px] border-2 border-dashed px-3 font-semibold"
                style={{
                  left: (dayIndex(span, b.checkin) + 0.5) * dayWidth + 2,
                  width: Math.max(
                    dayWidth - 4,
                    (dayIndex(span, b.checkout) - dayIndex(span, b.checkin)) * dayWidth - 4,
                  ),
                }}
              >
                <span className="truncate">{b.guestName ?? t("common.noName")}</span>
              </button>
            );
          })}
        </div>
      </ApartmentRow>
    </div>
  );
});

/** Spreads stays over as few lanes as possible so overlapping ones sit one under the other. */
export function laneOf(bookings: CalendarBooking[]): Map<string, number> {
  const ends: IsoDate[] = [];
  const out = new Map<string, number>();
  const sorted = [...bookings].sort((a, b) => (a.checkin < b.checkin ? -1 : a.checkin > b.checkin ? 1 : 0));
  for (const b of sorted) {
    let lane = ends.findIndex((end) => end <= b.checkin);
    if (lane === -1) lane = ends.length;
    ends[lane] = b.checkout;
    out.set(b.id, lane);
  }
  return out;
}

const LANE_HEIGHT = 64;

/** "Χωρίς διαμέρισμα": finished stays that were never put in an apartment, under the apartment rows. */
function PastUnplacedRow({
  props,
  drawn,
  rowBookings,
}: {
  props: CalendarGridProps;
  drawn: DrawnDaysStore;
  rowBookings: CalendarBooking[];
}) {
  const t = useTranslations("calendar");
  const { span, dayWidth, selectedId, onOpen } = props;
  const { firstDay, lastDay } = useSyncExternalStore(drawn.subscribe, drawn.get, drawn.get);
  const visible = (start: IsoDate, end: IsoDate) => dayIndex(span, end) >= firstDay && dayIndex(span, start) <= lastDay;
  // Lanes for what is on screen only, so stays months away don't make the row tall and empty.
  const shown = rowBookings.filter((b) => visible(b.checkin, b.checkout));
  const lanes = laneOf(shown);
  const laneCount = Math.max(1, ...[...lanes.values()].map((l) => l + 1));
  return (
    <div
      role="group"
      aria-label={t("pastUnplaced")}
      className="border-border bg-surface-muted relative flex border-b"
      style={{ height: laneCount * LANE_HEIGHT + 24 }}
      data-testid="past-unplaced-row"
    >
      <div
        className="border-border bg-surface-muted sticky left-0 z-10 flex w-52 flex-none flex-col justify-center gap-0.5 border-r px-4"
        style={{ width: LABEL_WIDTH }}
      >
        <span className="text-base font-semibold">{t("pastUnplaced")}</span>
        <span className="text-text-muted text-xs">{t("pastUnplacedHint")}</span>
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="relative h-full" style={{ width: span.days * dayWidth }}>
          {shown.map((b) => (
            <DraggableBar
              key={b.id}
              booking={b}
              color={null}
              selected={b.id === selectedId}
              needsRoom
              onOpen={onOpen}
              className="absolute"
              style={{
                top: 12 + (lanes.get(b.id) ?? 0) * LANE_HEIGHT,
                left: (dayIndex(span, b.checkin) + 0.5) * dayWidth + 2,
                width: Math.max(dayWidth - 4, (dayIndex(span, b.checkout) - dayIndex(span, b.checkin)) * dayWidth - 4),
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The day header and one row per apartment; day cells are drawn around the visible days, bars for all loaded data. */
export const CalendarGrid = memo(function CalendarGrid(props: CalendarGridProps) {
  const { drawn, bookings, proposed, today, blocks } = props;
  const { byRoom, proposedByRoom, pastUnplaced, blocksByRoom } = useMemo(() => {
    const byRoom = new Map<string, CalendarBooking[]>();
    const proposedByRoom = new Map<string, CalendarBooking[]>();
    const pastUnplaced: CalendarBooking[] = [];
    for (const b of bookings) {
      const proposedRoom = b.assignment ? undefined : proposed?.get(b.id);
      if (proposedRoom) proposedByRoom.set(proposedRoom, [...(proposedByRoom.get(proposedRoom) ?? []), b]);
      else if (!b.assignment && b.checkout <= today && b.status !== "pending") pastUnplaced.push(b);
      if (!b.assignment) continue;
      byRoom.set(b.assignment.roomId, [...(byRoom.get(b.assignment.roomId) ?? []), b]);
    }
    const blocksByRoom = new Map<string, CalendarBlock[]>();
    for (const b of blocks) blocksByRoom.set(b.roomId, [...(blocksByRoom.get(b.roomId) ?? []), b]);
    return { byRoom, proposedByRoom, pastUnplaced, blocksByRoom };
  }, [bookings, proposed, today, blocks]);
  return (
    <div style={{ width: LABEL_WIDTH + props.span.days * props.dayWidth }}>
      <DayHeader
        span={props.span}
        dayWidth={props.dayWidth}
        today={today}
        overbooked={props.overbooked}
        drawn={drawn}
      />
      {props.rooms.map((room) => (
        <RoomTrack
          key={room.id}
          room={room}
          span={props.span}
          dayWidth={props.dayWidth}
          today={today}
          selectedId={props.selectedId}
          drop={props.dropStates.get(room.id) ?? null}
          rowBookings={byRoom.get(room.id) ?? EMPTY}
          rowBlocks={blocksByRoom.get(room.id) ?? EMPTY_BLOCKS}
          rowProposed={proposedByRoom.get(room.id) ?? EMPTY}
          onOpen={props.onOpen}
        />
      ))}
      {pastUnplaced.length > 0 ? <PastUnplacedRow props={props} drawn={drawn} rowBookings={pastUnplaced} /> : null}
    </div>
  );
});
