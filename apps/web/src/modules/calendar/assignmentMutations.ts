import { AllocationMutationError } from "./allocationErrors";
import type { BookingDragPayload } from "./optimisticMove";

export { AllocationMutationError, isStaleVersionError } from "./allocationErrors";

export type AssignmentMutationResult = {
  assignment: { id: string; roomId: string; version: number } | null;
};

type ApiBody = {
  data?: { assignment?: { id?: string; roomId?: string; version?: number } | null };
  error?: {
    code?: string;
    message?: string;
    details?: { assignment?: { id?: string; roomId?: string; version?: number } };
  };
} | null;

/** Send a request; throws {@link AllocationMutationError} on any failure (network included). */
async function send(url: string, method: string, body: unknown): Promise<ApiBody> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
  } catch {
    throw new AllocationMutationError(undefined);
  }
  const j = (await res.json().catch(() => null)) as ApiBody;
  if (!res.ok) {
    throw new AllocationMutationError(j?.error?.code, j?.error?.details);
  }
  return j;
}

function readAssignment(j: ApiBody): AssignmentMutationResult["assignment"] {
  const a = j?.data?.assignment;
  if (a && typeof a.id === "string" && typeof a.roomId === "string" && typeof a.version === "number") {
    return { id: a.id, roomId: a.roomId, version: a.version };
  }
  return null;
}

function reassign(assignmentId: string, roomId: string, expectedVersion: number) {
  return send(`/api/assignments/${encodeURIComponent(assignmentId)}/reassign`, "PATCH", {
    roomId,
    expectedVersion,
  });
}

/** Server mutations for assign / reassign / unassign (no optimistic state). */
export async function performBookingAssignmentMutation(
  raw: BookingDragPayload,
  toRoomId: string | null,
): Promise<AssignmentMutationResult> {
  if (toRoomId === null) {
    if (!raw.assignmentId || raw.assignmentVersion == null) {
      throw new AllocationMutationError("STALE_VERSION");
    }
    await send(`/api/assignments/${encodeURIComponent(raw.assignmentId)}/unassign`, "POST", {
      expectedVersion: raw.assignmentVersion,
    });
    return { assignment: null };
  }

  if (raw.assignmentId != null && raw.assignmentVersion != null) {
    return { assignment: readAssignment(await reassign(raw.assignmentId, toRoomId, raw.assignmentVersion)) };
  }

  try {
    const j = await send("/api/assignments", "POST", { bookingId: raw.bookingId, roomId: toRoomId });
    return { assignment: readAssignment(j) };
  } catch (e) {
    if (!(e instanceof AllocationMutationError) || e.code !== "BOOKING_ALREADY_ASSIGNED") throw e;
    // The booking was assigned elsewhere meanwhile: retry as a reassign using the current version.
    const existing = (e.details as { assignment?: { id?: string; version?: number } } | undefined)
      ?.assignment;
    if (!existing || typeof existing.id !== "string" || typeof existing.version !== "number") {
      throw new AllocationMutationError("STALE_VERSION");
    }
    return { assignment: readAssignment(await reassign(existing.id, toRoomId, existing.version)) };
  }
}

export async function applyBookingSuggestionMutation(
  bookingId: string,
  roomId: string,
  expectedVersion?: number,
): Promise<void> {
  await send(
    `/api/bookings/${encodeURIComponent(bookingId)}/suggestions/${encodeURIComponent(roomId)}/apply`,
    "POST",
    expectedVersion == null ? {} : { expectedVersion },
  );
}
