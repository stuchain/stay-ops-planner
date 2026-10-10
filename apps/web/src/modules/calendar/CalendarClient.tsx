"use client";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  NeedsAssignmentDragCard,
  NeedsAssignmentDropZone,
  type OverviewUnassignedBooking,
} from "./NeedsAssignmentStrip";
import {
  applyConfirmedAssignmentToMonths,
  applyOptimisticBookingMoveToMonths,
  bookingItemToDragPayload,
  restoreBookingInMonths,
  snapshotBookingInMonths,
  type BookingDragPayload,
  type CalendarDataByMonth,
} from "./optimisticMove";
import { bookingDropTargetFromOverId } from "./dropTarget";
import { useIsNarrowViewport } from "./useIsNarrowViewport";
import { useI18n } from "@/i18n/I18nProvider";
import { ToastBanner } from "@/modules/ui";
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

export function CalendarClient() {
  const { t } = useI18n();
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
  const [dataByMonth, setDataByMonthState] = useState<CalendarDataByMonth>({});
  /** Latest calendar data, readable from async callbacks without stale closures. */
  const dataByMonthRef = useRef<CalendarDataByMonth>({});
  const setDataByMonth = useCallback(
    (update: CalendarDataByMonth | ((prev: CalendarDataByMonth) => CalendarDataByMonth)) => {
      const next = typeof update === "function" ? update(dataByMonthRef.current) : update;
      dataByMonthRef.current = next;
      setDataByMonthState(next);
    },
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockModal, setBlockModal] = useState<
    null | { mode: "create" } | { mode: "edit"; block: CalendarBlockItem }
  >(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [reorderEnabled, setReorderEnabled] = useState(false);
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

  /** Each load gets a number; only the newest one may write to the screen. */
  const loadSeqRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  /** Moves sent to the server and not answered yet. */
  const movesInFlightRef = useRef(0);
  /** A reload was asked for while a move was in flight; run it once all moves settle. */
  const reloadAfterMovesRef = useRef(false);

  const load = useCallback(async (baseYm: string, monthCount: 1 | 2 | 3) => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const seq = ++loadSeqRef.current;
    const isLatest = () => seq === loadSeqRef.current;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 45_000);
    setLoading(true);
    const fetchOpts: RequestInit = { credentials: "include", signal: controller.signal };
    try {
      const months = Array.from({ length: monthCount }, (_, idx) => shiftMonth(baseYm, idx));
      const monthsPromise = Promise.all(
        months.map(async (ym) => {
          const res = await fetch(`/api/calendar/month?month=${encodeURIComponent(ym)}`, fetchOpts);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      const overviewPromise = fetch(
        `/api/bookings/overview?month=${encodeURIComponent(baseYm)}`,
        fetchOpts,
      ).then(async (res) => {
        if (!res.ok) return null;
        const overviewJson = (await res.json()) as {
          data: {
            rooms: Array<{ id: string; label: string; maxGuests: number | null }>;
            unassigned: OverviewUnassignedBooking[];
          };
        };
        return { rooms: overviewJson.data.rooms, unassigned: overviewJson.data.unassigned };
      });
      const [monthPayloads, nextOverview] = await Promise.all([monthsPromise, overviewPromise]);
      if (!isLatest()) return;
      setDataByMonth(Object.fromEntries(monthPayloads));
      setOverview(nextOverview);
      setError(null);
    } catch (e) {
      if (!isLatest()) return;
      // Keep whatever is already on screen; only say that this refresh failed.
      const aborted = e instanceof Error && e.name === "AbortError";
      if (aborted && !timedOut) return;
      setError(timedOut ? t("calendar.loadTimeout") : t("calendar.loadFailed"));
    } finally {
      clearTimeout(timer);
      if (isLatest()) {
        setLoading(false);
        loadAbortRef.current = null;
      }
    }
  }, [setDataByMonth, t]);

  /** Reload now, or once the moves still waiting on the server have settled. */
  const reloadWhenIdle = useCallback(() => {
    if (movesInFlightRef.current > 0) {
      reloadAfterMovesRef.current = true;
      return;
    }
    void load(month, displayMonths);
  }, [displayMonths, load, month]);

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
      reloadWhenIdle();
    }
    window.addEventListener("ops:hosthub-sync-tick", onSyncTick);
    return () => window.removeEventListener("ops:hosthub-sync-tick", onSyncTick);
  }, [reloadWhenIdle]);

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
    async (raw: BookingDragPayload, toRoomId: string | null): Promise<boolean> => {
      if (toRoomId === raw.fromRoomId) return true;
      const bookingId = raw.bookingId;
      const snapshot = snapshotBookingInMonths(dataByMonthRef.current, bookingId);
      let removedUnassigned: { item: OverviewUnassignedBooking; index: number } | null = null;
      setDataByMonth((prev) => applyOptimisticBookingMoveToMonths(prev, bookingId, toRoomId));
      if (toRoomId !== null) {
        setOverview((prev) => {
          if (!prev) return prev;
          const index = prev.unassigned.findIndex((u) => u.bookingId === bookingId);
          if (index < 0) return prev;
          removedUnassigned = { item: prev.unassigned[index]!, index };
          return { ...prev, unassigned: prev.unassigned.filter((u) => u.bookingId !== bookingId) };
        });
      }
      setFlash(null);
      // A load that started before this move would show the booking in its old place.
      loadAbortRef.current?.abort();
      loadSeqRef.current += 1;
      setLoading(false);
      movesInFlightRef.current += 1;
      let ok = false;
      try {
        const result = await performBookingAssignmentMutation(raw, toRoomId);
        if (toRoomId === null || result.assignment) {
          setDataByMonth((prev) =>
            applyConfirmedAssignmentToMonths(prev, bookingId, result.assignment),
          );
        }
        ok = true;
      } catch (e) {
        setDataByMonth((prev) => restoreBookingInMonths(prev, bookingId, snapshot, toRoomId));
        const removed = removedUnassigned as { item: OverviewUnassignedBooking; index: number } | null;
        if (removed) {
          setOverview((prev) => {
            if (!prev || prev.unassigned.some((u) => u.bookingId === bookingId)) return prev;
            const unassigned = [...prev.unassigned];
            unassigned.splice(Math.min(removed.index, unassigned.length), 0, removed.item);
            return { ...prev, unassigned };
          });
        }
        setFlash(e instanceof Error ? e.message : t("calendar.assignFail"));
      } finally {
        movesInFlightRef.current -= 1;
        if (movesInFlightRef.current === 0) {
          reloadAfterMovesRef.current = false;
          void load(month, displayMonths);
        }
      }
      return ok;
    },
    [displayMonths, load, month, setDataByMonth, t],
  );

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (isMobile) return;
      const activeId = String(active.id);
      if (!over) {
        if (activeId.startsWith("room-order:")) return;
        const dragged = active.data.current as BookingDragPayload | undefined;
        if (dragged?.type === "booking") setFlash(t("calendar.dropOnApartment"));
        return;
      }
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
      const target = bookingDropTargetFromOverId(String(over.id));
      if (target === null) {
        setFlash(t("calendar.dropOnApartment"));
        return;
      }
      const toRoomId = target === "unassigned" ? null : target;
      if (toRoomId === raw.fromRoomId) return;
      await completeAssignment(raw, toRoomId);
    },
    [completeAssignment, displayMonths, isMobile, load, month, orderedRoomIds, t],
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
    try {
      const ok = await completeAssignment(
        {
          type: "booking",
          bookingId,
          assignmentId: null,
          assignmentVersion: null,
          fromRoomId: null,
        },
        roomId,
      );
      if (ok) setFlash(t("calendar.assignedOk"));
    } finally {
      setAssigningBookingId(null);
    }
  }

  const missingVisibleData = visibleMonths.some((ym) => !dataByMonth[ym]);
  const initialLoading = loading && missingVisibleData;
  const refreshing = loading && !initialLoading;
  const retryLoad = () => void load(month, displayMonths);

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
      <main className="ops-calendar-main">
        <header className="ops-calendar-header">
          <h1>{t("calendar.title")}</h1>
        </header>
        <section className="ops-calendar-controls" aria-label="Calendar controls">
          <button type="button" className="ops-btn" onClick={() => setMonth(defaultMonthYm())}>
            {t("calendar.today")}
          </button>
          <input
            type="month"
            className="ops-input"
            aria-label={t("calendar.selectMonthAria")}
            value={month}
            onChange={(ev) => setMonth(ev.target.value)}
          />
          <label className="ops-label ops-inline-label">
            <span>{t("calendar.display")}</span>
            <select
              className="ops-input"
              value={displayMonths}
              onChange={(ev) => setDisplayMonths(Number(ev.target.value) as 1 | 2 | 3)}
              aria-label={t("calendar.displayMonthCount")}
            >
              <option value={1}>{t("calendar.month1")}</option>
              <option value={2}>{t("calendar.month2")}</option>
              <option value={3}>{t("calendar.month3")}</option>
            </select>
          </label>
          <button type="button" className="ops-btn" onClick={() => setFlash(t("calendar.filtersSoon"))}>
            {t("calendar.filters")}
          </button>
          <button type="button" className="ops-btn" disabled={!baseData} onClick={() => setQueueOpen(true)}>
            {t("calendar.unassignedList")}
          </button>
          {!isMobile ? (
            <button
              type="button"
              className="ops-btn"
              aria-pressed={reorderEnabled}
              data-testid="ops-reorder-toggle"
              onClick={() => setReorderEnabled((v) => !v)}
            >
              {t("calendar.reorderRows")}
            </button>
          ) : null}
          <span className="ops-muted" role="status" aria-live="polite">
            {refreshing ? t("calendar.refreshing") : ""}
          </span>
        </section>
        {!initialLoading && overview && (
          <section className="ops-needs-table" aria-label="Needs assignment table">
            <div className="ops-needs-row">
              <div className="ops-needs-label">{t("calendar.needsAssignment")}</div>
              <NeedsAssignmentDropZone laneId={`${month}:lane-unassigned`}>
                {overview.unassigned.length === 0 ? (
                  <span className="ops-muted">{t("calendar.allAssigned")}</span>
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
        {flash ? <ToastBanner>{flash}</ToastBanner> : null}
        {error ? (
          <div className="ops-error" role="alert">
            <span>{error}</span>{" "}
            <button type="button" className="ops-btn" onClick={retryLoad}>
              {t("calendar.retry")}
            </button>
          </div>
        ) : null}
        <section
          className={
            isMobile || displayMonths === 1
              ? `ops-multi-month-grid ops-multi-month-${displayMonths}`
              : "ops-multi-month-grid"
          }
        >
          {!isMobile && displayMonths > 1 ? (
            error && missingVisibleData ? null : (
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
                    loading={initialLoading}
                    error={null}
                    onPrevMonth={() => setMonth((m) => shiftMonth(m, -1))}
                    onNextMonth={() => setMonth((m) => shiftMonth(m, 1))}
                    sortableRoomIds={reorderEnabled ? orderedRoomIds : null}
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
                loading={initialLoading && !error}
                error={null}
                onPrevMonth={() => setMonth((m) => shiftMonth(m, -1))}
                onNextMonth={() => setMonth((m) => shiftMonth(m, 1))}
                onEditBlock={(block) => setBlockModal({ mode: "edit", block })}
                isMobile={isMobile}
                onQuickAssign={isMobile ? (b) => setMobileAssignBooking(b) : undefined}
                laneScope={ym}
                showNavigation={!isMobile}
                sortableRoomIds={!isMobile && reorderEnabled ? orderedRoomIds : null}
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
