import { formatAllocationError } from "./optimisticMove";
import type { BookingDragPayload } from "./optimisticMove";

/** Server mutations for assign / reassign / unassign (no optimistic state). */
export async function performBookingAssignmentMutation(
  raw: BookingDragPayload,
  toRoomId: string | null,
): Promise<void> {
  if (toRoomId === null) {
    if (!raw.assignmentId || raw.assignmentVersion == null) {
      throw new Error("Drag to unassigned requires an existing assignment.");
    }
    const res = await fetch(`/api/assignments/${encodeURIComponent(raw.assignmentId)}/unassign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ expectedVersion: raw.assignmentVersion }),
    });
    const j = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    if (!res.ok) {
      throw new Error(formatAllocationError(j?.error?.code, j?.error?.message ?? res.statusText));
    }
    return;
  }

  if (raw.assignmentId != null && raw.assignmentVersion != null) {
    const res = await fetch(`/api/assignments/${encodeURIComponent(raw.assignmentId)}/reassign`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ roomId: toRoomId, expectedVersion: raw.assignmentVersion }),
    });
    const j = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    if (!res.ok) {
      throw new Error(formatAllocationError(j?.error?.code, j?.error?.message ?? res.statusText));
    }
    return;
  }

  const res = await fetch("/api/assignments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ bookingId: raw.bookingId, roomId: toRoomId }),
  });
  const j = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  if (!res.ok) {
    throw new Error(formatAllocationError(j?.error?.code, j?.error?.message ?? res.statusText));
  }
}
