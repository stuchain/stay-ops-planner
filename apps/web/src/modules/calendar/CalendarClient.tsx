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
import { useCallback, useEffect, useState } from "react";
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

export function CalendarClient() {
  const [month, setMonth] = useState(() => {
    if (typeof window === "undefined") return defaultMonthYm();
    const stored = window.localStorage.getItem(CALENDAR_MONTH_STORAGE_KEY);
    return stored && /^\d{4}-\d{2}$/.test(stored) ? stored : defaultMonthYm();
  });
  const [data, setData] = useState<CalendarMonthPayload | null>(null);
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

  const load = useCallback(async (ym: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/calendar/month?month=${encodeURIComponent(ym)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { data: CalendarMonthPayload };
      setData(json.data);
      const overviewRes = await fetch(`/api/bookings/overview?month=${encodeURIComponent(ym)}`, {
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
      setData(null);
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [month, load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CALENDAR_MONTH_STORAGE_KEY, month);
  }, [month]);

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
      if (!data) return;
      if (toRoomId === raw.fromRoomId) return;
      const snapshot = structuredClone(data);
      setData(applyOptimisticBookingMove(data, raw.bookingId, toRoomId));
      setFlash(null);
      try {
        await performBookingAssignmentMutation(raw, toRoomId);
        await load(month);
      } catch (e) {
        setData(snapshot);
        setFlash(e instanceof Error ? e.message : "Request failed");
      }
    },
    [data, load, month],
  );

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!data || !over || isMobile) return;
      const raw = active.data.current as BookingDragPayload | undefined;
      if (!raw || raw.type !== "booking") return;
      const target = parseLaneDropTarget(String(over.id));
      if (target === null) return;
      const toRoomId = target === "unassigned" ? null : target;
      if (toRoomId === raw.fromRoomId) return;
      await completeAssignment(raw, toRoomId);
    },
    [completeAssignment, data, isMobile],
  );

  const roomOptions: BlockRoomOption[] = (data?.rooms ?? []).map((r) => ({
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
      await load(month);
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
        <MonthGrid
          data={data}
          loading={loading}
          error={error}
          onPrevMonth={() => setMonth((m) => shiftMonth(m, -1))}
          onNextMonth={() => setMonth((m) => shiftMonth(m, 1))}
          onCurrentMonth={() => setMonth(defaultMonthYm())}
          onAddBlock={() => setBlockModal({ mode: "create" })}
          onEditBlock={(block) => setBlockModal({ mode: "edit", block })}
          isMobile={isMobile}
          onQuickAssign={isMobile ? (b) => setMobileAssignBooking(b) : undefined}
          onOpenUnassigned={data ? () => setQueueOpen(true) : undefined}
        />
        {data && (
          <UnassignedDrawer
            open={queueOpen}
            month={month}
            rooms={data.rooms}
            onClose={() => setQueueOpen(false)}
            onAssigned={() => void load(month)}
          />
        )}
        {data && (
          <MobileAssignSheet
            open={mobileAssignBooking != null}
            booking={mobileAssignBooking}
            rooms={data.rooms}
            onClose={() => setMobileAssignBooking(null)}
            onPickRoom={async (toRoomId) => {
              if (!mobileAssignBooking) return;
              const raw = bookingItemToDragPayload(mobileAssignBooking);
              setMobileAssignBooking(null);
              await completeAssignment(raw, toRoomId);
            }}
          />
        )}
        {blockModal && data && (
          <BlockEditorModal
            open
            mode={blockModal.mode}
            block={blockModal.mode === "edit" ? blockModal.block : null}
            rooms={roomOptions}
            defaultMonth={data.month}
            onClose={() => setBlockModal(null)}
            onSaved={() => void load(month)}
          />
        )}
      </main>
    </DndContext>
  );
}
