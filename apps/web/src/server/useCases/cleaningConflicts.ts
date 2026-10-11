/** What the double-booking check needs from a cleaning. */
export type ConflictCandidate = {
  id: string;
  status: string;
  assigneeName: string | null;
  start: Date;
  end: Date;
};

function key(name: string | null): string | null {
  const value = name?.trim().toLocaleLowerCase("el");
  return value ? value : null;
}

/**
 * For every open cleaning, the other open cleanings the same person is booked on at an overlapping time
 * (E4-5). Tasks that touch end to start do not overlap. Finished and cancelled ones are history.
 */
export function findCleanerConflicts(tasks: readonly ConflictCandidate[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const open = tasks.filter((t) => (t.status === "todo" || t.status === "in_progress") && key(t.assigneeName) !== null);
  for (const a of open) {
    for (const b of open) {
      if (a.id === b.id || key(a.assigneeName) !== key(b.assigneeName)) continue;
      if (a.start < b.end && b.start < a.end) out.set(a.id, [...(out.get(a.id) ?? []), b.id]);
    }
  }
  return out;
}
