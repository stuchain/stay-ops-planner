"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyBookingSuggestionMutation,
  performBookingAssignmentMutation,
} from "@/modules/calendar/assignmentMutations";
import { bookingItemToDragPayload } from "@/modules/calendar/optimisticMove";
import type { CalendarBookingItem, CalendarRoom } from "@/modules/calendar/calendarTypes";
import { SUGGESTION_REASON_CODE_LABELS, type SuggestionReasonCode } from "@/modules/suggestions/types";
import { ChannelLogo } from "./ChannelLogo";

type UnassignedRow = {
  id: string;
  channel: string;
  externalBookingId: string;
  checkinDate: string;
  checkoutDate: string;
  nights: number;
};

type SuggestionItem = {
  roomId: string;
  score: number;
  reasonCodes: SuggestionReasonCode[];
  breakdown: {
    availability: number;
    cleaningFit: number;
    tieBreaker: number;
  };
};

function monthRangeForUnassignedApi(ym: string): { from: string; to: string } {
  const p = ym.split("-");
  const y = Number(p[0]);
  const m = Number(p[1]);
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const to = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  return { from, to };
}

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

type Props = {
  open: boolean;
  month: string;
  rooms: CalendarRoom[];
  onClose: () => void;
  /** After a successful assign, refresh calendar + drawer. */
  onAssigned: () => void;
};

export function UnassignedDrawer({ open, month, rooms, onClose, onAssigned }: Props) {
  const [rows, setRows] = useState<UnassignedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const [roomPick, setRoomPick] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, SuggestionItem[]>>({});

  const loadRows = useCallback(async () => {
    const { from, to } = monthRangeForUnassignedApi(month);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/bookings/unassigned?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { credentials: "include" },
      );
      const j = (await res.json().catch(() => null)) as {
        data?: { bookings: UnassignedRow[] };
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      setRows(j?.data?.bookings ?? []);
      setSuggestions({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [month]);

  const loadSuggestions = useCallback(async (bookingId: string) => {
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/suggestions`, {
        credentials: "include",
      });
      const j = (await res.json().catch(() => null)) as {
        data?: SuggestionItem[];
      } | null;
      if (!res.ok) return;
      setSuggestions((prev) => ({ ...prev, [bookingId]: j?.data ?? [] }));
    } catch {
      setSuggestions((prev) => ({ ...prev, [bookingId]: [] }));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadRows();
  }, [open, loadRows]);

  useEffect(() => {
    if (!open || rows.length === 0) return;
    void Promise.all(rows.map((row) => loadSuggestions(row.id)));
  }, [open, rows, loadSuggestions]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (b) =>
        b.id.toLowerCase().includes(q) ||
        b.externalBookingId.toLowerCase().includes(q) ||
        b.channel.toLowerCase().includes(q),
    );
  }, [rows, debouncedSearch]);

  const defaultRoomId = rooms[0]?.id ?? "";

  async function assignOne(row: UnassignedRow) {
    const roomId = roomPick[row.id] ?? defaultRoomId;
    if (!roomId) {
      setRowError((r) => ({ ...r, [row.id]: "Pick a room" }));
      return;
    }
    setRowError((r) => ({ ...r, [row.id]: "" }));
    setPendingId(row.id);
    const pseudo: CalendarBookingItem = {
      kind: "booking",
      id: row.id,
      roomId: null,
      startDate: row.checkinDate,
      endDate: row.checkoutDate,
      guestName: row.externalBookingId,
      channel: row.channel === "airbnb" || row.channel === "booking" ? row.channel : "direct",
      status: "confirmed",
      assignmentId: null,
      assignmentVersion: null,
      flags: ["unassigned"],
    };
    const raw = bookingItemToDragPayload(pseudo);
    try {
      await performBookingAssignmentMutation(raw, roomId);
      onAssigned();
      await loadRows();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Assign failed";
      setRowError((r) => ({ ...r, [row.id]: msg }));
    } finally {
      setPendingId(null);
    }
  }

  async function applySuggestion(row: UnassignedRow, roomId: string) {
    setRowError((r) => ({ ...r, [row.id]: "" }));
    setPendingId(row.id);
    try {
      await applyBookingSuggestionMutation(row.id, roomId, 0);
      onAssigned();
      await loadRows();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Apply suggestion failed";
      setRowError((r) => ({ ...r, [row.id]: msg }));
    } finally {
      setPendingId(null);
    }
  }

  if (!open) return null;

  return (
    <div className="ops-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="ops-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ops-drawer-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="ops-drawer-header">
          <h2 id="ops-drawer-title">Unassigned bookings</h2>
          <button type="button" className="ops-btn" onClick={onClose}>
            Close
          </button>
        </header>
        <label className="ops-label">
          Search
          <input
            className="ops-input"
            type="search"
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
            placeholder="Id, channel, external ref…"
          />
        </label>
        {loading && <p className="ops-muted">Loading…</p>}
        {error && <p className="ops-error">{error}</p>}
        {!loading && !error && filtered.length === 0 && <p className="ops-muted">No unassigned bookings in this range.</p>}
        <ul className="ops-drawer-list">
          {filtered.map((b) => (
            <li key={b.id} className="ops-drawer-row">
              <div className="ops-drawer-row-main">
                <div className="ops-drawer-dates">
                  {b.checkinDate} → {b.checkoutDate}
                </div>
                <div className="ops-drawer-meta">
                  <span className="ops-name-with-logo">
                    <ChannelLogo channel={b.channel} className="ops-channel-logo" />
                    <span>{b.channel}</span>
                  </span>{" "}
                  · {b.externalBookingId}
                </div>
                {rowError[b.id] && <p className="ops-error ops-drawer-row-err">{rowError[b.id]}</p>}
                <div className="ops-suggestion-list" aria-label={`Suggestions for booking ${b.id}`}>
                  {(suggestions[b.id] ?? []).slice(0, 3).map((s) => (
                    <div key={`${b.id}-${s.roomId}`} className="ops-suggestion-card">
                      <div className="ops-suggestion-score">Score {s.score}</div>
                      <div className="ops-suggestion-reasons">
                        {s.reasonCodes.slice(0, 2).map((code) => (
                          <span key={code} className="ops-suggestion-reason">
                            {SUGGESTION_REASON_CODE_LABELS[code]}
                          </span>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="ops-btn ops-btn-small"
                        disabled={pendingId === b.id}
                        onClick={() => void applySuggestion(b, s.roomId)}
                      >
                        {pendingId === b.id ? "Applying…" : "Apply suggestion"}
                      </button>
                    </div>
                  ))}
                  {(suggestions[b.id] ?? []).length === 0 && (
                    <p className="ops-muted">No ranked suggestions available yet.</p>
                  )}
                </div>
              </div>
              <div className="ops-drawer-row-actions">
                <select
                  className="ops-input"
                  value={roomPick[b.id] ?? defaultRoomId}
                  onChange={(ev) =>
                    setRoomPick((prev) => ({
                      ...prev,
                      [b.id]: ev.target.value,
                    }))
                  }
                  aria-label={`Room for booking ${b.id}`}
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code ?? r.name ?? r.id}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ops-btn ops-btn-primary"
                  disabled={pendingId === b.id || rooms.length === 0}
                  onClick={() => void assignOne(b)}
                >
                  {pendingId === b.id ? "…" : "Assign"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
