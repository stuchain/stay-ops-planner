"use client";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { cn } from "@/ui/cn";

// Dev mode only: the board keeps its own English text until Phase 4; styled with the new design tokens.
const BTN = cn(buttonBase, buttonVariants.secondary, buttonSizes.md);
const BTN_PRIMARY = cn(buttonBase, buttonVariants.primary, buttonSizes.md);
const INPUT = "min-h-target rounded-sm border border-border bg-surface px-3 text-sm text-text";
const LABEL = "flex flex-col gap-1 text-sm font-semibold";
const MUTED = "text-text-muted text-sm";

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
    const snapshot = tasks.map((x) => ({ ...x }));
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
    <main className="flex flex-col gap-4" data-testid="ops-cleaning-board">
      <header className="sr-only">
        <h1>Cleaning board</h1>
      </header>
      {flash && (
        <div className="bg-danger-soft text-text rounded-sm px-4 py-3 text-sm" role="alert">
          {flash}
        </div>
      )}
      <section className="flex flex-wrap items-end gap-4">
        <label className={LABEL}>
          Day (planned start)
          <input
            className={INPUT}
            type="date"
            value={filterDate}
            onChange={(ev) => setFilterDate(ev.target.value)}
          />
        </label>
        <label className={LABEL}>
          Assignee (exact)
          <input
            className={INPUT}
            type="text"
            value={assignee}
            onChange={(ev) => setAssignee(ev.target.value)}
            placeholder="Name on task"
          />
        </label>
        <label className={LABEL}>
          Status
          <select
            className={INPUT}
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
        <button type="button" className={BTN} onClick={() => void load()}>
          Refresh
        </button>
      </section>
      {loading && <p className={MUTED}>Loading tasks…</p>}
      {error && <p className="text-danger text-sm font-semibold">{error}</p>}
      {!loading && !error && tasks.length === 0 && <p className={MUTED}>No tasks match filters.</p>}
      {!loading &&
        !error &&
        tasks.length > 0 &&
        STATUSES.map((st) => {
          const list = grouped.get(st) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={st} className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold capitalize">{st.replace("_", " ")}</h2>
              <ul className="flex flex-col gap-3">
                {list.map((t) => (
                  <li key={t.id} className="bg-surface border-border rounded-card shadow-card flex flex-col gap-1 border p-4 text-sm" data-testid={`ops-cleaning-task-${t.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{t.taskType}</span>
                      <span className={MUTED}>{t.id.slice(0, 8)}…</span>
                    </div>
                    <div className="text-text-muted">
                      Room {t.roomId.slice(0, 8)}… · Booking {t.bookingId.slice(0, 8)}…
                    </div>
                    {t.assigneeName && <div>Assignee: {t.assigneeName}</div>}
                    {t.plannedStart && (
                      <div className="text-text-muted">
                        {new Date(t.plannedStart).toLocaleString()} →{" "}
                        {t.plannedEnd ? new Date(t.plannedEnd).toLocaleString() : "—"}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {t.status === "todo" && (
                        <button
                          type="button"
                          className={BTN_PRIMARY}
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
                          className={BTN_PRIMARY}
                          data-testid={`ops-cleaning-complete-${t.id}`}
                          disabled={pendingId === t.id}
                          onClick={() => void patchStatus(t, "done")}
                        >
                          Complete
                        </button>
                      )}
                      <button type="button" className={BTN} onClick={() => openReschedule(t)}>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={() => setRescheduleTask(null)}>
          <div className="bg-surface rounded-card shadow-raised flex w-full max-w-md flex-col gap-4 p-6" onClick={(ev) => ev.stopPropagation()}>
            <h2 className="text-lg font-semibold">Reschedule task</h2>
            <form className="flex flex-col gap-4" onSubmit={(ev) => void submitReschedule(ev)}>
              <label className={LABEL}>
                Planned start
                <input
                  className={INPUT}
                  type="datetime-local"
                  value={rsStart}
                  onChange={(ev) => setRsStart(ev.target.value)}
                  required
                />
              </label>
              <label className={LABEL}>
                Planned end
                <input
                  className={INPUT}
                  type="datetime-local"
                  value={rsEnd}
                  onChange={(ev) => setRsEnd(ev.target.value)}
                  required
                />
              </label>
              <label className={LABEL}>
                Assignee name
                <input
                  className={INPUT}
                  type="text"
                  value={rsAssignee}
                  onChange={(ev) => setRsAssignee(ev.target.value)}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" className={BTN} onClick={() => setRescheduleTask(null)}>
                  Cancel
                </button>
                <button type="submit" className={BTN_PRIMARY} disabled={pendingId === rescheduleTask.id}>
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
