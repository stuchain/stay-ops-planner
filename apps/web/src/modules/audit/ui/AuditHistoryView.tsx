"use client";

import { useEffect, useMemo, useState } from "react";

type AuditRow = {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: unknown;
  afterJson: unknown;
  metaJson: unknown;
  createdAt: string;
  redacted: boolean;
};

type AuditResponse = {
  data: AuditRow[];
  page: { nextCursor: string | null; limit: number };
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function sevenDaysAgoIsoDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

export function AuditHistoryView() {
  const [entityType, setEntityType] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [from, setFrom] = useState(sevenDaysAgoIsoDate());
  const [to, setTo] = useState(todayIsoDate());
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const queryString = useMemo(() => {
    const q = new URLSearchParams();
    q.set("from", from);
    q.set("to", to);
    if (entityType.trim()) q.set("entityType", entityType.trim());
    if (bookingId.trim()) q.set("bookingId", bookingId.trim());
    if (roomId.trim()) q.set("roomId", roomId.trim());
    if (actorUserId.trim()) q.set("actorUserId", actorUserId.trim());
    q.set("limit", "20");
    return q.toString();
  }, [entityType, bookingId, roomId, actorUserId, from, to]);

  async function load(reset: boolean, cursor?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams(queryString);
      if (cursor) qs.set("cursor", cursor);
      const res = await fetch(`/api/audit/events?${qs.toString()}`, { credentials: "include" });
      const json = (await res.json().catch(() => null)) as AuditResponse | { error?: { message?: string } } | null;
      if (!res.ok) {
        throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`);
      }
      const data = (json as AuditResponse).data ?? [];
      setRows((prev) => (reset ? data : [...prev, ...data]));
      setNextCursor((json as AuditResponse).page?.nextCursor ?? null);
      if (reset) setSelected(data[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit events");
      if (reset) setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
  }, [queryString]);

  return (
    <main className="ops-calendar-main">
      <h1>Audit history</h1>
      <div className="ops-cleaning-filters">
        <label className="ops-label">
          From
          <input className="ops-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="ops-label">
          To
          <input className="ops-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="ops-label">
          Entity type
          <input className="ops-input" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
        </label>
        <label className="ops-label">
          Booking id
          <input className="ops-input" value={bookingId} onChange={(e) => setBookingId(e.target.value)} />
        </label>
        <label className="ops-label">
          Room id
          <input className="ops-input" value={roomId} onChange={(e) => setRoomId(e.target.value)} />
        </label>
        <label className="ops-label">
          Actor user id
          <input className="ops-input" value={actorUserId} onChange={(e) => setActorUserId(e.target.value)} />
        </label>
      </div>
      {loading && <p className="ops-muted">Loading audit events…</p>}
      {error && <p className="ops-error">{error}</p>}
      {!loading && !error && rows.length === 0 && <p className="ops-muted">No audit events found.</p>}
      <ul className="ops-drawer-list">
        {rows.map((row) => (
          <li key={row.id} className="ops-drawer-row">
            <button type="button" className="ops-btn" onClick={() => setSelected(row)}>
              {row.createdAt} · {row.action} · {row.entityType}/{row.entityId}
              {row.redacted ? " · redacted" : ""}
            </button>
          </li>
        ))}
      </ul>
      {nextCursor && (
        <button type="button" className="ops-btn ops-btn-primary" disabled={loading} onClick={() => void load(false, nextCursor)}>
          Load more
        </button>
      )}

      {selected && (
        <section>
          <h2>Event detail</h2>
          <pre className="ops-pre">{JSON.stringify(selected, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}
