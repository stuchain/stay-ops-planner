"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CalendarMarker } from "./calendarTypes";
import { useOverlayAccessibility } from "@/modules/ui/useOverlayAccessibility";

function severityRank(sev: string): number {
  const s = sev.toLowerCase();
  if (s === "error") return 0;
  if (s === "warning") return 1;
  if (s === "info") return 2;
  return 3;
}

function severityChipClass(sev: string): string {
  const s = sev.toLowerCase();
  if (s === "error") return "ops-warnings-severity ops-warnings-severity--error";
  if (s === "warning") return "ops-warnings-severity ops-warnings-severity--warning";
  if (s === "info") return "ops-warnings-severity ops-warnings-severity--info";
  return "ops-warnings-severity ops-warnings-severity--neutral";
}

export function SyncWarningsInfo({
  markers,
  onOpenBooking,
}: {
  markers: CalendarMarker[];
  onOpenBooking?: (bookingId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useOverlayAccessibility({
    open,
    panelRef,
    onRequestClose: () => setOpen(false),
    useInert: true,
  });

  const sorted = useMemo(() => {
    return markers
      .map((m, idx) => ({ m, idx }))
      .sort((a, b) => {
        const ra = severityRank(a.m.severity);
        const rb = severityRank(b.m.severity);
        if (ra !== rb) return ra - rb;
        return a.idx - b.idx;
      })
      .map(({ m }) => m);
  }, [markers]);

  if (markers.length === 0) return null;

  const modal = open ? (
    <div
      className="ops-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={panelRef}
        className="ops-modal ops-warnings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ops-warnings-modal-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 id="ops-warnings-modal-title">Sync warnings ({markers.length})</h2>
        <div className="ops-warnings-list">
          {sorted.map((m, i) => (
            <div key={`${m.kind}:${m.bookingId ?? ""}:${m.severity}:${m.message}:${m.code ?? ""}:${i}`} className="ops-warnings-row">
              <div className="ops-warnings-row-head">
                <span className={severityChipClass(m.severity)}>{m.severity}</span>
                <span className="ops-warnings-kind">{m.kind}</span>
              </div>
              {m.code ? <div className="ops-warnings-code">{m.code}</div> : null}
              <div className="ops-warnings-msg">{m.message}</div>
              {m.bookingId ? (
                <div className="ops-warnings-booking-row">
                  <span className="ops-warnings-booking-id">{m.bookingId}</span>
                  {onOpenBooking ? (
                    <button
                      type="button"
                      className="ops-btn ops-btn-primary"
                      onClick={() => {
                        setOpen(false);
                        onOpenBooking(m.bookingId!);
                      }}
                    >
                      Open booking
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="ops-modal-actions">
          <button type="button" className="ops-btn" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="ops-markers ops-markers--calendar-sync" role="status">
        <span>{markers.length} sync warning(s) found.</span>
        <button
          type="button"
          className="ops-markers-info-btn"
          aria-label="View sync warning details"
          title="View details"
          onClick={() => setOpen(true)}
        >
          <span aria-hidden="true">i</span>
        </button>
      </div>
      {modal && typeof document !== "undefined" ? createPortal(modal, document.body) : null}
    </>
  );
}
