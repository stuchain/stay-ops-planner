"use client";

import Link from "next/link";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UnassignedDrawer } from "@/modules/bookings/UnassignedDrawer";
import { BlockEditorModal, type BlockRoomOption } from "@/modules/blocks/BlockEditorModal";
import type { CalendarBlockItem, CalendarBookingItem, CalendarMonthPayload } from "./calendarTypes";
import { MonthGrid } from "./MonthGrid";
import { performBookingAssignmentMutation } from "./assignmentMutations";
import { MobileAssignSheet } from "./MobileAssignSheet";
import {
  applyOptimisticBookingMove,
  bookingItemToDragPayload,
  parseLaneDropTarget,
  type BookingDragPayload,
} from "./optimisticMove";
import { useIsNarrowViewport } from "./useIsNarrowViewport";

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
    rooms: Array<{ id: string; label: string }>;
    unassigned: Array<{
      bookingId: string;
      guestName: string;
      checkinDate: string;
      checkoutDate: string;
      status: string;
    }>;
  } | null>(null);
  const [roomPick, setRoomPick] = useState<Record<string, string>>({});
  const visibleMonths = useMemo(
    () => Array.from({ length: displayMonths }, (_, idx) => shiftMonth(month, idx)),
    [month, displayMonths],
  );
  const baseData = dataByMonth[month] ?? null;

  const load = useCallback(async (baseYm: string, monthCount: 1 | 2 | 3) => {
    setLoading(true);
    setError(null);
    try {
      const months = Array.from({ length: monthCount }, (_, idx) => shiftMonth(baseYm, idx));
      const monthPayloads = await Promise.all(
        months.map(async (ym) => {
          const res = await fetch(`/api/calendar/month?month=${encodeURIComponent(ym)}`, {
            credentials: "include",
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
            throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
          }
          const json = (await res.json()) as { data: CalendarMonthPayload };
          return [ym, json.data] as const;
        }),
      );
      setDataByMonth(Object.fromEntries(monthPayloads));

      const overviewRes = await fetch(`/api/bookings/overview?month=${encodeURIComponent(baseYm)}`, {
        credentials: "include",
      });
      if (overviewRes.ok) {
        const overviewJson = (await overviewRes.json()) as {
          data: {
            rooms: Array<{ id: string; label: string }>;
            unassigned: Array<{
              bookingId: string;
              guestName: string;
              checkinDate: string;
              checkoutDate: string;
              status: string;
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
      setError(e instanceof Error ? e.message : "Failed to load");
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
      const raw = active.data.current as BookingDragPayload | undefined;
      if (!raw || raw.type !== "booking") return;
      const overId = String(over.id);
      const targetId = overId.includes(":") ? overId.slice(overId.indexOf(":") + 1) : overId;
      const target = parseLaneDropTarget(targetId);
      if (target === null) return;
      const toRoomId = target === "unassigned" ? null : target;
      if (toRoomId === raw.fromRoomId) return;
      await completeAssignment(raw, toRoomId);
    },
    [completeAssignment, isMobile],
  );

  const roomOptions: BlockRoomOption[] = (baseData?.rooms ?? []).map((r) => ({
    id: r.id,
    label: r.code ? `${r.code}${r.name ? ` — ${r.name}` : ""}` : r.name || r.id,
  }));

  async function assignFromSimplePanel(bookingId: string) {
    if (!overview) return;
    const roomId = roomPick[bookingId] ?? overview.rooms[0]?.id;
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
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
      <main className="ops-calendar-main">
        <header className="ops-calendar-header">
          <h1>Bookings</h1>
          <Link className="ops-btn" href="/app/cleaning">
            Cleaning tasks
          </Link>
        </header>
        <section className="ops-calendar-controls" aria-label="Calendar controls">
          <button type="button" className="ops-btn" onClick={() => setMonth(defaultMonthYm())}>
            Today
          </button>
          <button type="button" className="ops-btn" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            ◀
          </button>
          <button type="button" className="ops-btn" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            ▶
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
          <button
            type="button"
            className="ops-btn ops-btn-primary"
            disabled={!baseData}
            onClick={() => setBlockModal({ mode: "create" })}
          >
            Block dates
          </button>
        </section>
        {!loading && !error && overview && (
          <section className="ops-markers" aria-label="Needs assignment">
            <h2>Needs assignment</h2>
            {overview.unassigned.length === 0 ? (
              <p className="ops-muted">All bookings are assigned for this month.</p>
            ) : (
              <ul className="ops-drawer-list">
                {overview.unassigned.map((booking) => (
                  <li key={booking.bookingId} className="ops-drawer-row">
                    <div className="ops-drawer-row-main">
                      <strong>{booking.guestName}</strong>
                      <div className="ops-drawer-dates">
                        {booking.checkinDate} → {booking.checkoutDate}
                      </div>
                      <div className="ops-drawer-meta">Status: {booking.status}</div>
                    </div>
                    <div className="ops-drawer-row-actions">
                      <select
                        className="ops-input"
                        value={roomPick[booking.bookingId] ?? overview.rooms[0]?.id ?? ""}
                        onChange={(ev) =>
                          setRoomPick((prev) => ({
                            ...prev,
                            [booking.bookingId]: ev.target.value,
                          }))
                        }
                        aria-label={`Apartment for booking ${booking.bookingId}`}
                      >
                        {overview.rooms.map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="ops-btn ops-btn-primary"
                        disabled={assigningBookingId === booking.bookingId || overview.rooms.length === 0}
                        onClick={() => void assignFromSimplePanel(booking.bookingId)}
                      >
                        {assigningBookingId === booking.bookingId ? "Assigning..." : "Assign apartment"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {flash && (
          <div className="ops-toast" role="alert">
            {flash}
          </div>
        )}
        <section className={`ops-multi-month-grid ops-multi-month-${displayMonths}`}>
          {visibleMonths.map((ym) => (
            <MonthGrid
              key={ym}
              data={dataByMonth[ym] ?? null}
              loading={loading}
              error={error}
              onPrevMonth={() => setMonth((m) => shiftMonth(m, -1))}
              onNextMonth={() => setMonth((m) => shiftMonth(m, 1))}
              onCurrentMonth={() => setMonth(defaultMonthYm())}
              onAddBlock={() => setBlockModal({ mode: "create" })}
              onEditBlock={(block) => setBlockModal({ mode: "edit", block })}
              isMobile={isMobile}
              onQuickAssign={isMobile ? (b) => setMobileAssignBooking(b) : undefined}
              onOpenUnassigned={baseData ? () => setQueueOpen(true) : undefined}
              laneScope={ym}
              showNavigation={false}
            />
          ))}
        </section>
        {baseData && (
          <UnassignedDrawer
            open={queueOpen}
            month={month}
            rooms={baseData.rooms}
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
      </main>
    </DndContext>
  );
}
