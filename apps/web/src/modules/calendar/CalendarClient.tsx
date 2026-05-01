"use client";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BookingDetailModal } from "@/modules/bookings/BookingDetailModal";
import { UnassignedDrawer } from "@/modules/bookings/UnassignedDrawer";
import { BlockEditorModal, type BlockRoomOption } from "@/modules/blocks/BlockEditorModal";
import type {
  CalendarBlockItem,
  CalendarBookingItem,
  CalendarMonthPayload,
} from "./calendarTypes";
import { MonthGrid } from "./MonthGrid";
import { MultiMonthTimeline } from "./MultiMonthTimeline";
import { performBookingAssignmentMutation } from "./assignmentMutations";
import { MobileAssignSheet } from "./MobileAssignSheet";
import {
  applyOptimisticBookingMove,
  bookingItemToDragPayload,
  parseLaneDropTarget,
  type BookingDragPayload,
} from "./optimisticMove";
import { useIsNarrowViewport } from "./useIsNarrowViewport";
import { ChannelLogo } from "@/modules/bookings/ChannelLogo";
import { suggestDefaultRoomForBooking } from "./assignmentSuggest";

function shiftMonth(ym: string, delta: number): string {
  const parts = ym.split("-");
  const ys = Number(parts[0]);
  const ms = Number(parts[1]);
  const d = new Date(Date.UTC(ys, ms - 1 + delta, 1));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function defaultMonthYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const CALENDAR_MONTH_STORAGE_KEY = "ops.calendar.month";
const CALENDAR_DISPLAY_MONTHS_STORAGE_KEY = "ops.calendar.displayMonths";

type OverviewUnassignedBooking = {
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

export function CalendarClient() {
  const [month, setMonth] = useState(() => {
    if (typeof window === "undefined") return defaultMonthYm();
    const stored = window.localStorage.getItem(CALENDAR_MONTH_STORAGE_KEY);
    return stored && /^\d{4}-\d{2}$/.test(stored) ? stored : defaultMonthYm();
  });
  const [displayMonths, setDisplayMonths] = useState<1 | 2 | 3>(() => {
    if (typeof window === "undefined") return 1;
    const stored = window.localStorage.getItem(CALENDAR_DISPLAY_MONTHS_STORAGE_KEY);
    if (stored === "2") return 2;
    if (stored === "3") return 3;
    return 1;
  });
  const [dataByMonth, setDataByMonth] = useState<Record<string, CalendarMonthPayload>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockModal, setBlockModal] = useState<
    null | { mode: "create" } | { mode: "edit"; block: CalendarBlockItem }
  >(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [mobileAssignBooking, setMobileAssignBooking] = useState<CalendarBookingItem | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [assigningBookingId, setAssigningBookingId] = useState<string | null>(null);
  const isMobile = useIsNarrowViewport();
  const [overview, setOverview] = useState<{
    rooms: Array<{ id: string; label: string; maxGuests: number | null }>;
    unassigned: OverviewUnassignedBooking[];
  } | null>(null);
  const [roomPick, setRoomPick] = useState<Record<string, string>>({});
  const [orderedRoomIds, setOrderedRoomIds] = useState<string[] | null>(null);
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);
  const visibleMonths = useMemo(
    () => Array.from({ length: displayMonths }, (_, idx) => shiftMonth(month, idx)),
    [month, displayMonths],
  );
  const baseData = dataByMonth[month] ?? null;

  const load = useCallback(async (baseYm: string, monthCount: 1 | 2 | 3) => {
    setLoading(true);
    setError(null);
    const fetchOpts: RequestInit = {
      credentials: "include",
      signal: AbortSignal.timeout(45_000),
    };
    try {
      const months = Array.from({ length: monthCount }, (_, idx) => shiftMonth(baseYm, idx));
      const monthPayloads = await Promise.all(
        months.map(async (ym) => {
          const res = await fetch(`/api/calendar/month?month=${encodeURIComponent(ym)}`, fetchOpts);
          if (!res.ok) {
            const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
            throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
          }
          const json = (await res.json()) as { data: CalendarMonthPayload };
          const payload = json.data;
          return [
            ym,
            {
              ...payload,
              dailyRatesByRoomDay: payload.dailyRatesByRoomDay ?? {},
            },
          ] as const;
        }),
      );
      setDataByMonth(Object.fromEntries(monthPayloads));

      const overviewRes = await fetch(
        `/api/bookings/overview?month=${encodeURIComponent(baseYm)}`,
        fetchOpts,
      );
      if (overviewRes.ok) {
        const overviewJson = (await overviewRes.json()) as {
          data: {
            rooms: Array<{ id: string; label: string; maxGuests: number | null }>;
            unassigned: Array<{
              bookingId: string;
              guestName: string;
              guestTotal: number | null;
              guestAdults: number | null;
              guestChildren: number | null;
              guestInfants: number | null;
              checkinDate: string;
              checkoutDate: string;
              status: string;
              channel: "airbnb" | "booking" | "direct";
            }>;
          };
        };
        setOverview({
          rooms: overviewJson.data.rooms,
          unassigned: overviewJson.data.unassigned,
        });
      } else {
        setOverview(null);
      }
    } catch (e) {
      let message = e instanceof Error ? e.message : "Failed to load";
      if (e instanceof Error && e.name === "AbortError") {
        message =
          "Request timed out. Ensure Docker Postgres is running and DATABASE_URL is set (use the repo-root .env from .env.example).";
      }
      setError(message);
      setDataByMonth({});
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month, displayMonths);
  }, [month, displayMonths, load]);

  useEffect(() => {
    if (!baseData?.rooms.length) return;
    setOrderedRoomIds((prev) => {
      const ids = baseData.rooms.map((r) => r.id);
      if (!prev || ids.length !== prev.length || !ids.every((id) => prev.includes(id))) return ids;
      return prev;
    });
  }, [baseData]);

  const unassignedDrawerSuggestContext = useMemo(() => {
    if (!baseData) return undefined;
    const parts = baseData.month.split("-").map(Number);
    const y = parts[0] ?? 2020;
    const m = parts[1] ?? 1;
    return {
      month: baseData.month,
      monthDayCount: new Date(y, m, 0).getDate(),
      bookings: baseData.items.filter((i): i is CalendarBookingItem => i.kind === "booking"),
      blocks: baseData.items.filter((i): i is CalendarBlockItem => i.kind === "block"),
    };
  }, [baseData]);

  const defaultRoomIdByBooking = useMemo(() => {
    if (!overview || !baseData) return {} as Record<string, string>;
    const parts = baseData.month.split("-").map(Number);
    const y = parts[0] ?? 2020;
    const m = parts[1] ?? 1;
    const monthDayCount = new Date(y, m, 0).getDate();
    const bookings = baseData.items.filter((i): i is CalendarBookingItem => i.kind === "booking");
    const blocks = baseData.items.filter((i): i is CalendarBlockItem => i.kind === "block");
    const roomOpts = overview.rooms.map((r) => ({
      id: r.id,
      label: r.label,
      maxGuests: r.maxGuests ?? null,
    }));
    const out: Record<string, string> = {};
    for (const u of overview.unassigned) {
      const sug = suggestDefaultRoomForBooking(
        {
          guestTotal: u.guestTotal,
          guestAdults: u.guestAdults,
          guestChildren: u.guestChildren,
          guestInfants: u.guestInfants,
        },
        roomOpts,
        u.checkinDate,
        u.checkoutDate,
        baseData.month,
        monthDayCount,
        bookings,
        blocks,
      );
      if (sug) out[u.bookingId] = sug;
    }
    return out;
  }, [overview, baseData]);

  useEffect(() => {
    function onSyncTick() {
      void load(month, displayMonths);
    }
    window.addEventListener("ops:hosthub-sync-tick", onSyncTick);
    return () => window.removeEventListener("ops:hosthub-sync-tick", onSyncTick);
  }, [displayMonths, load, month]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CALENDAR_MONTH_STORAGE_KEY, month);
  }, [month]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CALENDAR_DISPLAY_MONTHS_STORAGE_KEY, String(displayMonths));
  }, [displayMonths]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 5200);
    return () => clearTimeout(t);
  }, [flash]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerHits = pointerWithin(args);
    if (pointerHits.length > 0) {
      return pointerHits;
    }
    return closestCenter(args);
  }, []);

  const completeAssignment = useCallback(
    async (raw: BookingDragPayload, toRoomId: string | null) => {
      if (toRoomId === raw.fromRoomId) return;
      const ownerMonth = visibleMonths.find((ym) =>
        (dataByMonth[ym]?.items ?? []).some((i) => i.kind === "booking" && i.id === raw.bookingId),
      );
      if (!ownerMonth) return;
      const ownerData = dataByMonth[ownerMonth];
      if (!ownerData) return;
      const snapshot = structuredClone(ownerData);
      setDataByMonth((prev) => ({
        ...prev,
        [ownerMonth]: applyOptimisticBookingMove(ownerData, raw.bookingId, toRoomId),
      }));
      setFlash(null);
      try {
        await performBookingAssignmentMutation(raw, toRoomId);
        await load(month, displayMonths);
      } catch (e) {
        setDataByMonth((prev) => ({ ...prev, [ownerMonth]: snapshot }));
        setFlash(e instanceof Error ? e.message : "Request failed");
      }
    },
    [dataByMonth, displayMonths, load, month, visibleMonths],
  );

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || isMobile) return;
      const activeId = String(active.id);
      if (activeId.startsWith("room-order:")) {
        const overId = String(over.id);
        if (!overId.startsWith("room-order:") || !orderedRoomIds) return;
        const from = activeId.replace("room-order:", "");
        const to = overId.replace("room-order:", "");
        if (from === to) return;
        const oldIndex = orderedRoomIds.indexOf(from);
        const newIndex = orderedRoomIds.indexOf(to);
        if (oldIndex < 0 || newIndex < 0) return;
        const next = arrayMove(orderedRoomIds, oldIndex, newIndex);
        setOrderedRoomIds(next);
        setFlash(null);
        try {
          const res = await fetch("/api/rooms/reorder", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ orderedRoomIds: next }),
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
            setFlash(j?.error?.message ?? "Could not save room order");
            await load(month, displayMonths);
            return;
          }
          await load(month, displayMonths);
        } catch (e) {
          setFlash(e instanceof Error ? e.message : "Could not save room order");
          await load(month, displayMonths);
        }
        return;
      }

      const raw = active.data.current as BookingDragPayload | undefined;
      if (!raw || raw.type !== "booking") return;
      const overId = String(over.id);
      const targetId = overId.includes(":") ? overId.slice(overId.indexOf(":") + 1) : overId;
      if (!targetId.startsWith("lane-")) return;
      const target = parseLaneDropTarget(targetId);
      if (target === null) return;
      const toRoomId = target === "unassigned" ? null : target;
      if (toRoomId === raw.fromRoomId) return;
      await completeAssignment(raw, toRoomId);
    },
    [completeAssignment, displayMonths, isMobile, load, month, orderedRoomIds],
  );

  const roomOptions: BlockRoomOption[] = (baseData?.rooms ?? []).map((r) => ({
    id: r.id,
    label: r.code ? `${r.code}${r.name ? ` — ${r.name}` : ""}` : r.name || r.id,
  }));

  async function assignFromSimplePanel(bookingId: string) {
    if (!overview) return;
    const roomId =
      roomPick[bookingId] ?? defaultRoomIdByBooking[bookingId] ?? overview.rooms[0]?.id;
    if (!roomId) {
      setFlash("No apartment available to assign.");
      return;
    }
    setAssigningBookingId(bookingId);
    setFlash(null);
    try {
      await performBookingAssignmentMutation(
        {
          type: "booking",
          bookingId,
          assignmentId: null,
          assignmentVersion: null,
          fromRoomId: null,
        },
        roomId,
      );
      setFlash("Booking assigned successfully.");
      await load(month, displayMonths);
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "Failed to assign booking.");
    } finally {
      setAssigningBookingId(null);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
      <main className="ops-calendar-main">
        <header className="ops-calendar-header">
          <h1>Calendar</h1>
        </header>
        <section className="ops-calendar-controls" aria-label="Calendar controls">
          <button type="button" className="ops-btn" onClick={() => setMonth(defaultMonthYm())}>
            Today
          </button>
          <input
            type="month"
            className="ops-input"
            aria-label="Select month"
            value={month}
            onChange={(ev) => setMonth(ev.target.value)}
          />
          <label className="ops-label ops-inline-label">
            <span>Display</span>
            <select
              className="ops-input"
              value={displayMonths}
              onChange={(ev) => setDisplayMonths(Number(ev.target.value) as 1 | 2 | 3)}
              aria-label="Display month count"
            >
              <option value={1}>1 month</option>
              <option value={2}>2 months</option>
              <option value={3}>3 months</option>
            </select>
          </label>
          <button type="button" className="ops-btn" onClick={() => setFlash("Filters are coming soon.")}>
            Filters
          </button>
          <button type="button" className="ops-btn" disabled={!baseData} onClick={() => setQueueOpen(true)}>
            Unassigned list
          </button>
        </section>
        {!loading && !error && overview && (
          <section className="ops-needs-table" aria-label="Needs assignment table">
            <div className="ops-needs-row">
              <div className="ops-needs-label">Needs assignment</div>
              <NeedsAssignmentDropZone laneId={`${month}:lane-unassigned`}>
                {overview.unassigned.length === 0 ? (
                  <span className="ops-muted">All bookings are assigned for this month.</span>
                ) : (
                  overview.unassigned.map((booking) => (
                    <NeedsAssignmentDragCard
                      key={booking.bookingId}
                      booking={booking}
                      roomValue={
                        roomPick[booking.bookingId] ??
                        defaultRoomIdByBooking[booking.bookingId] ??
                        ""
                      }
                      rooms={overview.rooms}
                      assigning={assigningBookingId === booking.bookingId}
                      onRoomChange={(roomId) =>
                        setRoomPick((prev) => ({
                          ...prev,
                          [booking.bookingId]: roomId,
                        }))
                      }
                      onAssign={() => void assignFromSimplePanel(booking.bookingId)}
                    />
                  ))
                )}
              </NeedsAssignmentDropZone>
            </div>
          </section>
        )}
        {flash && (
          <div className="ops-toast" role="alert">
            {flash}
          </div>
        )}
        <section
          className={
            isMobile || displayMonths === 1
              ? `ops-multi-month-grid ops-multi-month-${displayMonths}`
              : "ops-multi-month-grid"
          }
        >
          {!isMobile && displayMonths > 1 ? (
            error ? (
              <MultiMonthTimeline
                monthsData={[]}
                loading={false}
                error={error}
                onPrevMonth={() => setMonth((m) => shiftMonth(m, -1))}
                onNextMonth={() => setMonth((m) => shiftMonth(m, 1))}
                sortableRoomIds={orderedRoomIds}
                onBookingClick={(id) => setDetailBookingId(id)}
                onMarkerBookingClick={(id) => setDetailBookingId(id)}
              />
            ) : (
              (() => {
                const monthsPayloadList = visibleMonths.map((ym) => dataByMonth[ym]);
                const allReady = monthsPayloadList.every(
                  (p): p is CalendarMonthPayload => p != null,
                );
                if (!allReady) {
                  return <p className="ops-muted">Loading bookings…</p>;
                }
                return (
                  <MultiMonthTimeline
                    monthsData={monthsPayloadList}
                    loading={loading}
                    error={null}
                    onPrevMonth={() => setMonth((m) => shiftMonth(m, -1))}
                    onNextMonth={() => setMonth((m) => shiftMonth(m, 1))}
                    sortableRoomIds={orderedRoomIds}
                    onBookingClick={(id) => setDetailBookingId(id)}
                    onMarkerBookingClick={(id) => setDetailBookingId(id)}
                  />
                );
              })()
            )
          ) : (
            visibleMonths.map((ym) => (
              <MonthGrid
                key={ym}
                data={dataByMonth[ym] ?? null}
                loading={loading}
                error={error}
                onPrevMonth={() => setMonth((m) => shiftMonth(m, -1))}
                onNextMonth={() => setMonth((m) => shiftMonth(m, 1))}
                onEditBlock={(block) => setBlockModal({ mode: "edit", block })}
                isMobile={isMobile}
                onQuickAssign={isMobile ? (b) => setMobileAssignBooking(b) : undefined}
                laneScope={ym}
                showNavigation={!isMobile}
                sortableRoomIds={!isMobile ? orderedRoomIds : null}
                onBookingClick={!isMobile ? (id) => setDetailBookingId(id) : undefined}
                onMarkerBookingClick={(id) => setDetailBookingId(id)}
              />
            ))
          )}
        </section>
        {baseData && (
          <UnassignedDrawer
            open={queueOpen}
            month={month}
            rooms={baseData.rooms}
            suggestContext={unassignedDrawerSuggestContext}
            onClose={() => setQueueOpen(false)}
            onAssigned={() => void load(month, displayMonths)}
          />
        )}
        {baseData && (
          <MobileAssignSheet
            open={mobileAssignBooking != null}
            booking={mobileAssignBooking}
            rooms={baseData.rooms}
            onClose={() => setMobileAssignBooking(null)}
            onPickRoom={async (toRoomId) => {
              if (!mobileAssignBooking) return;
              const raw = bookingItemToDragPayload(mobileAssignBooking);
              setMobileAssignBooking(null);
              await completeAssignment(raw, toRoomId);
            }}
          />
        )}
        {blockModal && baseData && (
          <BlockEditorModal
            open
            mode={blockModal.mode}
            block={blockModal.mode === "edit" ? blockModal.block : null}
            rooms={roomOptions}
            defaultMonth={baseData.month}
            onClose={() => setBlockModal(null)}
            onSaved={() => void load(month, displayMonths)}
          />
        )}
        <BookingDetailModal
          bookingId={detailBookingId}
          onClose={() => setDetailBookingId(null)}
          onAfterSave={() => void load(month, displayMonths)}
        />
      </main>
    </DndContext>
  );
}

function NeedsAssignmentDragCard({
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
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({
    id: `needs-booking-${booking.bookingId}`,
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
      style={{
        ...dragStyle,
        opacity: isDragging ? 0.85 : 1,
      }}
    >
      <button
        type="button"
        className="ops-needs-drag-handle"
        title="Drag to an apartment row to assign"
        aria-label={`Drag booking ${booking.guestName}`}
        {...listeners}
        {...attributes}
      >
        Drag
      </button>
      <strong className="ops-name-with-logo">
        <ChannelLogo channel={booking.channel} className="ops-channel-logo" />
        <span>{booking.guestName}</span>
      </strong>
      <div className="ops-needs-dates">
        {booking.checkinDate} → {booking.checkoutDate}
      </div>
      <div className="ops-needs-actions">
        <select
          className="ops-input"
          value={roomValue}
          onChange={(ev) => onRoomChange(ev.target.value)}
          aria-label={`Apartment for booking ${booking.bookingId}`}
        >
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.label}
            </option>
          ))}
        </select>
        <button type="button" className="ops-btn ops-btn-primary" disabled={assigning || rooms.length === 0} onClick={onAssign}>
          {assigning ? "Assigning..." : "Assign"}
        </button>
      </div>
    </article>
  );
}

function NeedsAssignmentDropZone({
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
