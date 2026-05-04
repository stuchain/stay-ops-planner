"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { CalendarBlockItem } from "@/modules/calendar/calendarTypes";
import { useOverlayAccessibility } from "@/modules/ui/useOverlayAccessibility";

export type BlockRoomOption = { id: string; label: string };

type Props = {
  open: boolean;
  mode: "create" | "edit";
  block: CalendarBlockItem | null;
  rooms: BlockRoomOption[];
  defaultMonth: string;
  onClose: () => void;
  onSaved: () => void;
};

function firstDayOfMonth(ym: string): string {
  return `${ym}-01`;
}

function lastDayOfMonth(ym: string): string {
  const p = ym.split("-");
  const y = Number(p[0]);
  const m = Number(p[1]);
  const last = new Date(Date.UTC(y, m, 0));
  return last.toISOString().slice(0, 10);
}

function mapConflictMessage(code: string | undefined, fallback: string): string {
  if (code === "CONFLICT_ASSIGNMENT") return "That room is already booked for those nights.";
  if (code === "CONFLICT_BLOCK") return "That room is blocked for maintenance.";
  return fallback;
}

export function BlockEditorModal({
  open,
  mode,
  block,
  rooms,
  defaultMonth,
  onClose,
  onSaved,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [roomId, setRoomId] = useState("");
  const [startDate, setStartDate] = useState(firstDayOfMonth(defaultMonth));
  const [endDate, setEndDate] = useState(lastDayOfMonth(defaultMonth));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === "edit" && block) {
      setRoomId(block.roomId);
      setStartDate(block.startDate);
      setEndDate(block.endDate);
      setReason(block.reason ?? "");
    } else {
      setRoomId(rooms[0]?.id ?? "");
      setStartDate(firstDayOfMonth(defaultMonth));
      setEndDate(lastDayOfMonth(defaultMonth));
      setReason("");
    }
  }, [open, mode, block, rooms, defaultMonth]);

  useOverlayAccessibility({
    open,
    busy: pending,
    panelRef,
    onRequestClose: onClose,
    useInert: true,
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (mode === "create") {
        const res = await fetch("/api/blocks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ roomId, startDate, endDate, reason: reason || null }),
        });
        const json = (await res.json().catch(() => null)) as {
          error?: { code?: string; message?: string };
        } | null;
        if (!res.ok) {
          setError(mapConflictMessage(json?.error?.code, json?.error?.message ?? "Could not create block"));
          return;
        }
        onSaved();
        onClose();
        return;
      }

      if (mode === "edit" && block) {
        const res = await fetch(`/api/blocks/${encodeURIComponent(block.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ startDate, endDate, reason: reason || null }),
        });
        const json = (await res.json().catch(() => null)) as {
          error?: { code?: string; message?: string };
        } | null;
        if (!res.ok) {
          setError(mapConflictMessage(json?.error?.code, json?.error?.message ?? "Could not update block"));
          return;
        }
        onSaved();
        onClose();
      }
    } finally {
      setPending(false);
    }
  }

  async function onDelete() {
    if (!block || mode !== "edit") return;
    if (!window.confirm("Delete this maintenance block?")) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/blocks/${encodeURIComponent(block.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) {
        const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(json?.error?.message ?? "Could not delete block");
        return;
      }
      onSaved();
      onClose();
    } finally {
      setPending(false);
    }
  }

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const emptyRoomsTree =
    rooms.length === 0 ? (
      <div className="ops-modal-backdrop" role="presentation" onClick={onClose}>
        <div
          ref={panelRef}
          className="ops-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ops-block-modal-title"
          onClick={(ev) => ev.stopPropagation()}
        >
          <h2 id="ops-block-modal-title">Maintenance block</h2>
          <p className="ops-error">Add at least one room before creating blocks.</p>
          <button type="button" className="ops-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    ) : (
      <div className="ops-modal-backdrop" role="presentation" onClick={onClose}>
        <div
          ref={panelRef}
          className="ops-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ops-block-modal-title"
          onClick={(ev) => ev.stopPropagation()}
        >
          <h2 id="ops-block-modal-title">{mode === "create" ? "Add maintenance block" : "Edit maintenance block"}</h2>
          <form onSubmit={onSubmit} className="ops-modal-form">
            <label className="ops-label">
              Room
              <select
                className="ops-input"
                value={roomId}
                onChange={(ev) => setRoomId(ev.target.value)}
                required
                disabled={mode === "edit"}
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ops-label">
              Start date
              <input
                className="ops-input"
                type="date"
                value={startDate}
                onChange={(ev) => setStartDate(ev.target.value)}
                required
              />
            </label>
            <label className="ops-label">
              End date
              <input
                className="ops-input"
                type="date"
                value={endDate}
                onChange={(ev) => setEndDate(ev.target.value)}
                required
              />
            </label>
            <label className="ops-label">
              Reason (optional)
              <input className="ops-input" type="text" value={reason} onChange={(ev) => setReason(ev.target.value)} />
            </label>
            {error && <p className="ops-error">{error}</p>}
            <div className="ops-modal-actions">
              <button type="button" className="ops-btn" onClick={onClose} disabled={pending}>
                Cancel
              </button>
              {mode === "edit" && (
                <button type="button" className="ops-btn ops-btn-danger" onClick={() => void onDelete()} disabled={pending}>
                  Delete
                </button>
              )}
              <button type="submit" className="ops-btn ops-btn-primary" disabled={pending}>
                {pending ? "Saving…" : mode === "create" ? "Create" : "Save"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );

  return createPortal(emptyRoomsTree, document.body);
}
