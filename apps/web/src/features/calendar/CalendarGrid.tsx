"use client";

import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, Plus, Scissors } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { memo, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { addDays, shortGaps, type GapNights, type IsoDate } from "@stay-ops/domain";
import type { CalendarBlock, CalendarBooking, CalendarRoom } from "@/api/types";
import { ApartmentRow } from "@/ui/ApartmentRow";
import { cn } from "@/ui/cn";
import { formatDay, type UiLocale } from "@/ui/format";
import { barName } from "./barName";
import { DraggableBar, type BarPiece } from "./DraggableBar";
import { dateAt, dayIndex, monthsBetween, type DrawnDaysStore, type Span } from "./timeline";

/** Width of the sticky apartment column (ApartmentRow's label cell, w-52). */
export const LABEL_WIDTH = 208;

export type DropState = { state: "free" | "busy"; guest?: string } | null;

/** A booking, or some of its nights, on the way to an apartment (dragged, picked from the tray, or cut off). */
export type Placement = {
  booking: CalendarBooking;
  from: IsoDate;
  to: IsoDate;
  /** The apartment those nights are in now; null while the booking has none. */
  roomId: string | null;
};

/** One bar in an apartment row: a whole stay, or one apartment's part of a stay that changed apartment. */
type RowBar = { booking: CalendarBooking; piece: BarPiece };

/** Where a stay continues in another apartment: a dashed line on that day between the two rows. */
type Joint = { bookingId: string; day: IsoDate; part: "top" | "bottom" | "full" };

const EMPTY: CalendarBooking[] = [];
const EMPTY_BARS: RowBar[] = [];
const EMPTY_JOINTS: Joint[] = [];
const EMPTY_BLOCKS: CalendarBlock[] = [];
const EMPTY_GAPS: GapNights[] = [];

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
  /** The booking (or nights) being placed: every row outlines those dates, free or taken. */
  placing?: Placement | null;
  /** Nights cut off a stay and waiting for an apartment: drawn faded in their row until placed. */
  cut?: Placement | null;
  /**
   * Scissors on the selected bar, one on each day the stay could change apartment; pressing one cuts off the
   * nights from that day to the end of that piece. Left out, no scissors (viewers, past stays, while placing).
   */
  onCut?: ((bookingId: string, day: IsoDate) => void) | undefined;
  /** Puts `placing` in that apartment; without it (no right to change) the free outlines are only drawn. */
  onPlace?: ((roomId: string) => void) | undefined;
  /** A move is running or there is no internet: the free outlines are there but can't be pressed yet. */
  placeDisabled?: boolean;
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
                isToday ? "bg-accent font-bold text-on-accent" : (weekday === 0 || weekday === 6) && "bg-surface-muted",
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
  rowBars: RowBar[];
  /** Dashed lines where a stay continues in another apartment. */
  rowJoints: Joint[];
  rowBlocks: CalendarBlock[];
  rowProposed: CalendarBooking[];
  /** Single empty nights between stays, still to come: they cannot be sold. */
  rowGaps: GapNights[];
  /** The stay (or nights) being placed, outlined at its dates when this row has a drop state. */
  spot: Placement | null;
  onPlace: ((roomId: string) => void) | undefined;
  placeDisabled: boolean;
  onOpen: (bookingId: string) => void;
  onCut: ((bookingId: string, day: IsoDate) => void) | undefined;
};

/** One apartment row with all its loaded bars; does not depend on the scroll position, so scrolling never redraws it. */
const RoomTrack = memo(function RoomTrack({
  room,
  span,
  dayWidth,
  today,
  selectedId,
  drop,
  rowBars,
  rowJoints,
  rowBlocks,
  rowProposed,
  rowGaps,
  spot,
  onPlace,
  placeDisabled,
  onOpen,
  onCut,
}: RoomTrackProps) {
  const t = useTranslations();
  const { setNodeRef, isOver } = useDroppable({
    id: `room:${room.id}`,
    data: { roomId: room.id },
    disabled: !room.isActive,
  });
  const todayIndex = dayIndex(span, today);
  const spotStyle = (stay: Placement) => ({
    left: (dayIndex(span, stay.from) + 0.5) * dayWidth + 2,
    width: Math.max(dayWidth - 4, (dayIndex(span, stay.to) - dayIndex(span, stay.from)) * dayWidth - 4),
  });
  return (
    <div ref={setNodeRef}>
      <ApartmentRow
        name={room.name}
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
          {/* Under everything else, so whatever is in the way stays readable on top of the red. */}
          {spot && drop?.state === "busy" ? <PlaceSpot room={room} free={false} style={spotStyle(spot)} /> : null}
          {rowGaps.map((g) => (
            <div
              key={g.start}
              data-testid="gap-nights"
              className="border-warning bg-warning-soft text-warning-text text-base pointer-events-none absolute top-4 flex h-14 items-center justify-center overflow-hidden rounded-sm border-2 border-dashed px-1 font-semibold"
              style={{
                left: (dayIndex(span, g.start) + 0.5) * dayWidth + 2,
                width: g.nights * dayWidth - 4,
              }}
              role="img"
              aria-label={t("gapNights.label", { count: g.nights })}
              title={t("gapNights.label", { count: g.nights })}
            >
              {/* Just the number: the words never fit in one night's width. */}
              <span aria-hidden="true">{g.nights}</span>
            </div>
          ))}
          {rowBlocks.map((b) => (
            <div
              key={b.id}
              className="border-text-muted bg-surface-muted text-text-muted text-xs absolute top-4 flex h-14 items-center overflow-hidden rounded-sm border-2 border-dashed px-3"
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
          {rowJoints.map((j) => (
            <div
              key={`${j.bookingId}:${j.day}`}
              data-testid="stay-joint"
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute z-[1] w-0 border-l-2 border-dashed border-l-[#7A4CC2]",
                // The bar's middle is 44px down (top-4 + half of h-14).
                j.part === "bottom" ? "top-11 bottom-0" : j.part === "top" ? "top-0 h-11" : "inset-y-0",
              )}
              style={{ left: (dayIndex(span, j.day) + 0.5) * dayWidth - 1 }}
            />
          ))}
          {rowBars.map(({ booking: b, piece }) => (
            <DraggableBar
              stickyLeft={LABEL_WIDTH + 12}
              key={`${b.id}:${piece.start}`}
              booking={b}
              piece={piece}
              selected={b.id === selectedId}
              onOpen={onOpen}
              className="absolute top-4"
              style={{
                left: (dayIndex(span, piece.start) + 0.5) * dayWidth + 2,
                width: Math.max(dayWidth - 4, (dayIndex(span, piece.end) - dayIndex(span, piece.start)) * dayWidth - 4),
              }}
            />
          ))}
          {onCut
            ? rowBars
                .filter(({ booking: b, piece }) => b.id === selectedId && !piece.lifted)
                .flatMap(({ booking: b, piece }) => cutDays(piece.start, piece.end).map((day) => ({ b, day })))
                .map(({ b, day }) => (
                  <CutButton
                    key={`cut:${day}`}
                    day={day}
                    left={(dayIndex(span, day) + 0.5) * dayWidth}
                    onCut={() => onCut(b.id, day)}
                  />
                ))
            : null}
          {rowProposed.map((b) => {
            const guest = b.guestName ?? t("common.noName");
            const label = t("calendar.proposed", { guest });
            const width = Math.max(
              dayWidth - 4,
              (dayIndex(span, b.checkout) - dayIndex(span, b.checkin)) * dayWidth - 4,
            );
            return (
              <button
                key={b.id}
                type="button"
                data-testid="proposed-bar"
                onClick={() => onOpen(b.id)}
                aria-label={label}
                title={label}
                className="border-accent bg-accent-soft text-accent text-sm absolute top-4 flex h-14 items-center overflow-hidden rounded-sm border-2 border-dashed px-3 font-semibold"
                style={{ left: (dayIndex(span, b.checkin) + 0.5) * dayWidth + 2, width }}
              >
                <span className="truncate">{barName(guest, width + 36)}</span>
              </button>
            );
          })}
          {spot && drop?.state === "free" ? (
            <PlaceSpot
              room={room}
              free
              active={isOver}
              onPlace={onPlace}
              disabled={placeDisabled}
              style={spotStyle(spot)}
            />
          ) : null}
        </div>
      </ApartmentRow>
    </div>
  );
});

/** Narrower than this, "Βάλτε εδώ" does not fit and the outline shows a plus instead (the name keeps the words). */
const PLACE_TEXT_MIN_WIDTH = 100;

/**
 * Where the booking being placed would sit in this apartment: a green "Βάλτε εδώ" outline to press (or drop on)
 * when it is free, a red one under whatever is in the way when it is not. The row's label says who.
 */
function PlaceSpot({
  room,
  free,
  active = false,
  onPlace,
  disabled = false,
  style,
}: {
  room: CalendarRoom;
  free: boolean;
  /** A bar is being dragged over this row: the outline turns solid where it will land. */
  active?: boolean;
  onPlace?: ((roomId: string) => void) | undefined;
  disabled?: boolean;
  style: CSSProperties & { width: number };
}) {
  const t = useTranslations("calendar");
  if (!free)
    return (
      <div
        data-testid="place-spot-busy"
        aria-hidden="true"
        className="border-danger bg-danger-soft pointer-events-none absolute top-4 h-14 rounded-sm border-2 border-dashed"
        style={style}
      />
    );
  const look = cn(
    "border-success bg-success-soft text-success-text text-sm absolute top-4 flex h-14 items-center justify-center overflow-hidden rounded-sm border-2 px-2 font-semibold",
    active ? "border-solid shadow-card" : "border-dashed",
  );
  // Someone who can only look sees where it would go, with nothing to press.
  if (!onPlace)
    return (
      <div data-testid="place-spot" aria-hidden="true" className={cn(look, "pointer-events-none")} style={style} />
    );
  const label = t("placeIn", { room: room.name });
  return (
    <button
      type="button"
      data-testid="place-spot"
      onClick={() => onPlace(room.id)}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(look, "enabled:hover:border-solid enabled:cursor-pointer disabled:opacity-60")}
      style={style}
    >
      {style.width >= PLACE_TEXT_MIN_WIDTH ? (
        <span className="truncate">{t("placeHere")}</span>
      ) : (
        <Plus size={20} strokeWidth={2.5} aria-hidden="true" />
      )}
    </button>
  );
}

/** The days inside a piece where the guest could have changed apartment (every night but the first). */
function cutDays(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = addDays(start, 1); d < end; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Scissors on the bottom edge of the selected bar, at a day boundary: the stay changes apartment from this day. On the
 * edge, not the middle, so the guest's name stays readable.
 */
function CutButton({ day, left, onCut }: { day: IsoDate; left: number; onCut: () => void }) {
  const t = useTranslations("calendar");
  const locale = useLocale() as UiLocale;
  const label = t("cutFrom", { date: formatDay(day, locale) });
  return (
    <button
      type="button"
      data-testid="cut-stay"
      onClick={(event) => {
        event.stopPropagation();
        onCut();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      aria-label={label}
      title={label}
      data-cut-keep
      className="border-accent bg-surface text-accent hover:bg-accent hover:text-on-accent focus-visible:bg-accent focus-visible:text-on-accent shadow-raised absolute top-[61px] z-20 flex size-[24px] items-center justify-center rounded-full border-2"
      style={{ left: left - 12 }}
    >
      <Scissors size={13} strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}

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

/** "Περασμένες κρατήσεις": finished stays that were never put in an apartment, under the apartment rows. */
const PAST_ROW_KEY = "calendar.pastRow";

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
  // Folded at first; opening it is remembered on this device.
  const [opened, setOpen] = useState(false);
  // A past stay opened from search or Today shows even while the row is folded.
  const open = opened || rowBookings.some((b) => b.id === selectedId);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(PAST_ROW_KEY) === "open") setOpen(true);
    } catch {
      // No storage (private window): it stays folded.
    }
  }, []);
  const toggle = () => {
    setOpen(!opened);
    try {
      window.localStorage.setItem(PAST_ROW_KEY, opened ? "closed" : "open");
    } catch {
      // Not remembered, nothing else is lost.
    }
  };
  return (
    <div
      role="group"
      aria-label={t("pastUnplaced")}
      className="border-border bg-surface-muted relative flex border-b"
      style={{ height: open ? laneCount * LANE_HEIGHT + 24 : 48 }}
      data-testid="past-unplaced-row"
      data-open={open}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        data-testid="past-unplaced-toggle"
        className="border-border bg-surface-muted hover:bg-surface sticky left-0 z-10 flex w-52 flex-none items-center gap-2 border-r px-4 text-left"
        style={{ width: LABEL_WIDTH }}
      >
        <ChevronDown
          size={20}
          aria-hidden="true"
          className={cn("flex-none transition-transform", open ? "rotate-180" : "")}
        />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-base font-semibold">
            {t("pastUnplaced")} · {rowBookings.length}
          </span>
          {open ? <span className="text-text-muted text-xs">{t("pastUnplacedHint")}</span> : null}
        </span>
      </button>
      <div className="relative min-w-0 flex-1">
        <div className="relative h-full" style={{ width: span.days * dayWidth }}>
          {(open ? shown : []).map((b) => (
            <DraggableBar
              stickyLeft={LABEL_WIDTH + 12}
              key={b.id}
              booking={b}
              selected={b.id === selectedId}
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
  const { drawn, bookings, proposed, today, blocks, rooms, cut } = props;
  const { byRoom, jointsByRoom, proposedByRoom, pastUnplaced, blocksByRoom, gapsByRoom } = useMemo(() => {
    const byRoom = new Map<string, RowBar[]>();
    const jointsByRoom = new Map<string, Joint[]>();
    const proposedByRoom = new Map<string, CalendarBooking[]>();
    const pastUnplaced: CalendarBooking[] = [];
    const nameOf = new Map(rooms.map((r) => [r.id, r.name]));
    const rowOf = new Map(rooms.map((r, i) => [r.id, i]));
    const push = <T,>(map: Map<string, T[]>, key: string, value: T) => map.set(key, [...(map.get(key) ?? []), value]);
    for (const b of bookings) {
      const proposedRoom = b.assignment ? undefined : proposed?.get(b.id);
      if (proposedRoom) push(proposedByRoom, proposedRoom, b);
      else if (!b.assignment && b.checkout <= today && b.status !== "pending") pastUnplaced.push(b);
      if (b.pieces.length === 0) continue;
      // While nights are cut off this stay, they are drawn as their own faded piece in the same row.
      const pieces =
        cut && cut.booking.id === b.id
          ? b.pieces.flatMap((p) =>
              p.start <= cut.from && cut.to <= p.end && p.start < cut.from
                ? [
                    { ...p, end: cut.from, lifted: false },
                    { ...p, start: cut.from, end: cut.to, lifted: true },
                    ...(cut.to < p.end ? [{ ...p, start: cut.to, lifted: false }] : []),
                  ]
                : [{ ...p, lifted: false }],
            )
          : b.pieces.map((p) => ({ ...p, lifted: false }));
      pieces.forEach((p, index) => {
        const before = pieces[index - 1];
        push(byRoom, p.roomId, {
          booking: b,
          piece: {
            start: p.start,
            end: p.end,
            index,
            count: pieces.length,
            fromRoom: before && before.roomId !== p.roomId ? nameOf.get(before.roomId) : undefined,
            lifted: p.lifted,
          },
        });
        if (!before || before.roomId === p.roomId) return;
        const a = rowOf.get(before.roomId);
        const z = rowOf.get(p.roomId);
        if (a === undefined || z === undefined) return;
        const [top, bottom] = a < z ? [a, z] : [z, a];
        rooms.slice(top, bottom + 1).forEach((r, i) =>
          push(jointsByRoom, r.id, {
            bookingId: b.id,
            day: p.start,
            part: i === 0 ? "bottom" : top + i === bottom ? "top" : "full",
          }),
        );
      });
    }
    const blocksByRoom = new Map<string, CalendarBlock[]>();
    for (const b of blocks) push(blocksByRoom, b.roomId, b);
    const gapsByRoom = new Map<string, GapNights[]>();
    const occupied = [
      ...bookings.flatMap((b) => b.pieces.map((p) => ({ id: b.id, roomId: p.roomId, start: p.start, end: p.end }))),
      ...blocks.map((b) => ({ id: b.id, roomId: b.roomId, start: b.start, end: b.end })),
    ];
    for (const g of shortGaps(occupied, { after: today })) push(gapsByRoom, g.roomId, g);
    return { byRoom, jointsByRoom, proposedByRoom, pastUnplaced, blocksByRoom, gapsByRoom };
  }, [bookings, proposed, today, blocks, rooms, cut]);
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
          rowBars={byRoom.get(room.id) ?? EMPTY_BARS}
          rowJoints={jointsByRoom.get(room.id) ?? EMPTY_JOINTS}
          rowBlocks={blocksByRoom.get(room.id) ?? EMPTY_BLOCKS}
          rowProposed={proposedByRoom.get(room.id) ?? EMPTY}
          rowGaps={gapsByRoom.get(room.id) ?? EMPTY_GAPS}
          spot={props.placing ?? null}
          onPlace={props.onPlace}
          placeDisabled={props.placeDisabled ?? false}
          onOpen={props.onOpen}
          onCut={props.onCut}
        />
      ))}
      {pastUnplaced.length > 0 ? <PastUnplacedRow props={props} drawn={drawn} rowBookings={pastUnplaced} /> : null}
    </div>
  );
});
