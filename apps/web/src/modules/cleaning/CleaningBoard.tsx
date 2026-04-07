"use client";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type TaskRow = {
  id: string;
  bookingId: string;
  roomId: string;
  status: string | null;
  taskType: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  assigneeName: string | null;
  durationMinutes: number | null;
};

const STATUSES = ["todo", "in_progress", "done"] as const;

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CleaningBoard() {
  const [filterDate, setFilterDate] = useState("");
  const [assignee, setAssignee] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [rescheduleTask, setRescheduleTask] = useState<TaskRow | null>(null);
  const [rsStart, setRsStart] = useState("");
  const [rsEnd, setRsEnd] = useState("");
  const [rsAssignee, setRsAssignee] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams();
    if (filterDate) q.set("date", filterDate);
    if (assignee.trim()) q.set("assignee", assignee.trim());
    if (statusFilter) q.set("status", statusFilter);
    try {
      const res = await fetch(`/api/cleaning/tasks?${q.toString()}`, { credentials: "include" });
      const j = (await res.json().catch(() => null)) as {
        data?: { tasks: TaskRow[] };
        error?: { message?: string };
      } | null;
      if (!res.ok) throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      setTasks(j?.data?.tasks ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [filterDate, assignee, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4800);
    return () => clearTimeout(t);
  }, [flash]);

  const grouped = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const s of STATUSES) m.set(s, []);
    for (const t of tasks) {
      const st = t.status ?? "todo";
      const bucket = m.get(st) ?? m.get("todo")!;
      bucket.push(t);
    }
    return m;
  }, [tasks]);

  async function patchStatus(task: TaskRow, toStatus: "in_progress" | "done") {
    const snapshot = structuredClone(tasks);
    setTasks((prev) =>
      prev.map((x) => (x.id === task.id ? { ...x, status: toStatus } : x)),
    );
    setPendingId(task.id);
    setFlash(null);
    try {
      const res = await fetch(`/api/cleaning/tasks/${encodeURIComponent(task.id)}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: toStatus }),
      });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        throw new Error(j?.error?.message ?? res.statusText);
      }
      await load();
    } catch (e) {
      setTasks(snapshot);
      setFlash(e instanceof Error ? e.message : "Update failed");
    } finally {
      setPendingId(null);
    }
  }

  function openReschedule(t: TaskRow) {
    setRescheduleTask(t);
    setRsStart(toLocalInputValue(t.plannedStart));
    setRsEnd(toLocalInputValue(t.plannedEnd));
    setRsAssignee(t.assigneeName ?? "");
  }

  async function submitReschedule(e: FormEvent) {
    e.preventDefault();
    if (!rescheduleTask) return;
    const start = new Date(rsStart);
    const end = new Date(rsEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setFlash("Invalid schedule times");
      return;
    }
    setPendingId(rescheduleTask.id);
    setFlash(null);
    try {
      const res = await fetch(`/api/cleaning/tasks/${encodeURIComponent(rescheduleTask.id)}/schedule`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          plannedStart: start.toISOString(),
          plannedEnd: end.toISOString(),
          assigneeName: rsAssignee.trim() || null,
        }),
      });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) throw new Error(j?.error?.message ?? res.statusText);
      setRescheduleTask(null);
      await load();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : "Reschedule failed");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <main className="ops-cleaning-main" data-testid="ops-cleaning-board">
      <header className="ops-cleaning-header">
        <h1>Cleaning board</h1>
      </header>
      {flash && (
        <div className="ops-toast" role="alert">
          {flash}
        </div>
      )}
      <section className="ops-cleaning-filters">
        <label className="ops-label">
          Day (planned start)
          <input
            className="ops-input"
            type="date"
            value={filterDate}
            onChange={(ev) => setFilterDate(ev.target.value)}
          />
        </label>
        <label className="ops-label">
          Assignee (exact)
          <input
            className="ops-input"
            type="text"
            value={assignee}
            onChange={(ev) => setAssignee(ev.target.value)}
            placeholder="Name on task"
          />
        </label>
        <label className="ops-label">
          Status
          <select
            className="ops-input"
            value={statusFilter}
            onChange={(ev) => setStatusFilter(ev.target.value)}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ops-btn" onClick={() => void load()}>
          Refresh
        </button>
      </section>
      {loading && <p className="ops-muted">Loading tasks…</p>}
      {error && <p className="ops-error">{error}</p>}
      {!loading && !error && tasks.length === 0 && <p className="ops-muted">No tasks match filters.</p>}
      {!loading &&
        !error &&
        tasks.length > 0 &&
        STATUSES.map((st) => {
          const list = grouped.get(st) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={st} className="ops-cleaning-column">
              <h2 className="ops-cleaning-column-title">{st.replace("_", " ")}</h2>
              <ul className="ops-cleaning-list">
                {list.map((t) => (
                  <li key={t.id} className="ops-cleaning-card" data-testid={`ops-cleaning-task-${t.id}`}>
                    <div className="ops-cleaning-card-head">
                      <span className="ops-cleaning-type">{t.taskType}</span>
                      <span className="ops-muted">{t.id.slice(0, 8)}…</span>
                    </div>
                    <div className="ops-cleaning-meta">
                      Room {t.roomId.slice(0, 8)}… · Booking {t.bookingId.slice(0, 8)}…
                    </div>
                    {t.assigneeName && <div>Assignee: {t.assigneeName}</div>}
                    {t.plannedStart && (
                      <div className="ops-cleaning-time">
                        {new Date(t.plannedStart).toLocaleString()} →{" "}
                        {t.plannedEnd ? new Date(t.plannedEnd).toLocaleString() : "—"}
                      </div>
                    )}
                    <div className="ops-cleaning-actions">
                      {t.status === "todo" && (
                        <button
                          type="button"
                          className="ops-btn ops-btn-primary"
                          data-testid={`ops-cleaning-start-${t.id}`}
                          disabled={pendingId === t.id}
                          onClick={() => void patchStatus(t, "in_progress")}
                        >
                          Start
                        </button>
                      )}
                      {t.status === "in_progress" && (
                        <button
                          type="button"
                          className="ops-btn ops-btn-primary"
                          data-testid={`ops-cleaning-complete-${t.id}`}
                          disabled={pendingId === t.id}
                          onClick={() => void patchStatus(t, "done")}
                        >
                          Complete
                        </button>
                      )}
                      <button type="button" className="ops-btn" onClick={() => openReschedule(t)}>
                        Reschedule
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      {rescheduleTask && (
        <div className="ops-modal-backdrop" role="presentation" onClick={() => setRescheduleTask(null)}>
          <div className="ops-modal" onClick={(ev) => ev.stopPropagation()}>
            <h2>Reschedule task</h2>
            <form className="ops-modal-form" onSubmit={(ev) => void submitReschedule(ev)}>
              <label className="ops-label">
                Planned start
                <input
                  className="ops-input"
                  type="datetime-local"
                  value={rsStart}
                  onChange={(ev) => setRsStart(ev.target.value)}
                  required
                />
              </label>
              <label className="ops-label">
                Planned end
                <input
                  className="ops-input"
                  type="datetime-local"
                  value={rsEnd}
                  onChange={(ev) => setRsEnd(ev.target.value)}
                  required
                />
              </label>
              <label className="ops-label">
                Assignee name
                <input
                  className="ops-input"
                  type="text"
                  value={rsAssignee}
                  onChange={(ev) => setRsAssignee(ev.target.value)}
                />
              </label>
              <div className="ops-modal-actions">
                <button type="button" className="ops-btn" onClick={() => setRescheduleTask(null)}>
                  Cancel
                </button>
                <button type="submit" className="ops-btn ops-btn-primary" disabled={pendingId === rescheduleTask.id}>
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
