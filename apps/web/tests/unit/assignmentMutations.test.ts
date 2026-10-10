import { afterEach, describe, expect, it, vi } from "vitest";
import { AllocationMutationError, isStaleVersionError } from "../../src/modules/calendar/allocationErrors";
import { formatAllocationError } from "../../src/modules/calendar/optimisticMove";
import {
  applyBookingSuggestionMutation,
  performBookingAssignmentMutation,
} from "../../src/modules/calendar/assignmentMutations";

const GENERIC = "Κάτι πήγε στραβά. Δοκιμάστε ξανά.";
const STALE = "Η κράτηση άλλαξε μόλις τώρα. Η οθόνη ενημερώθηκε, δοκιμάστε ξανά.";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fresh = {
  type: "booking" as const,
  bookingId: "b1",
  assignmentId: null,
  assignmentVersion: null,
  fromRoomId: null,
};
const assigned = { ...fresh, assignmentId: "a1", assignmentVersion: 2, fromRoomId: "r0" };

afterEach(() => vi.unstubAllGlobals());

describe("allocation error map", () => {
  it("covers every code", () => {
    expect(formatAllocationError("CONFLICT_ASSIGNMENT")).toBe("Το διαμέρισμα είναι ήδη κλεισμένο εκείνες τις μέρες.");
    expect(formatAllocationError("CONFLICT_BLOCK")).toBe("Το διαμέρισμα είναι κλειστό εκείνες τις μέρες.");
    expect(formatAllocationError("STALE_VERSION")).toBe(STALE);
    expect(formatAllocationError("BOOKING_NOT_ASSIGNABLE")).toBe("Αυτή η κράτηση δεν έχει επιβεβαιωθεί ακόμη.");
    expect(formatAllocationError("ROOM_INACTIVE")).toBe("Αυτό το διαμέρισμα είναι απενεργοποιημένο.");
    expect(formatAllocationError("VALIDATION_ERROR", "raw")).toBe(GENERIC);
    expect(formatAllocationError("WHATEVER")).toBe(GENERIC);
    expect(formatAllocationError("toString")).toBe(GENERIC);
    expect(formatAllocationError(undefined)).toBe(GENERIC);
  });

  it("AllocationMutationError carries code and Greek message", () => {
    const e = new AllocationMutationError("CONFLICT_BLOCK");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("CONFLICT_BLOCK");
    expect(e.message).toBe("Το διαμέρισμα είναι κλειστό εκείνες τις μέρες.");
    expect(isStaleVersionError(e)).toBe(false);
    expect(isStaleVersionError(new AllocationMutationError("STALE_VERSION"))).toBe(true);
    expect(isStaleVersionError(new Error("STALE_VERSION"))).toBe(false);
  });
});

describe("performBookingAssignmentMutation", () => {
  it("returns the new assignment for assign, reassign and null for unassign", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    f.mockResolvedValueOnce(json(201, { data: { assignment: { id: "a1", roomId: "r1", version: 0 } } }));
    expect(await performBookingAssignmentMutation(fresh, "r1")).toEqual({
      assignment: { id: "a1", roomId: "r1", version: 0 },
    });
    f.mockResolvedValueOnce(json(200, { data: { assignment: { id: "a1", roomId: "r2", version: 3 } } }));
    expect(await performBookingAssignmentMutation(assigned, "r2")).toEqual({
      assignment: { id: "a1", roomId: "r2", version: 3 },
    });
    f.mockResolvedValueOnce(json(200, { data: { ok: true, assignment: null } }));
    expect(await performBookingAssignmentMutation(assigned, null)).toEqual({ assignment: null });
  });

  it("retries BOOKING_ALREADY_ASSIGNED as a reassign", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    f.mockResolvedValueOnce(
      json(409, {
        error: {
          code: "BOOKING_ALREADY_ASSIGNED",
          message: "x",
          details: { assignment: { id: "a9", roomId: "r0", version: 4 } },
        },
      }),
    );
    f.mockResolvedValueOnce(json(200, { data: { assignment: { id: "a9", roomId: "r1", version: 5 } } }));
    expect(await performBookingAssignmentMutation(fresh, "r1")).toEqual({
      assignment: { id: "a9", roomId: "r1", version: 5 },
    });
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[1]![0]).toBe("/api/assignments/a9/reassign");
    expect(JSON.parse(f.mock.calls[1]![1].body)).toEqual({ roomId: "r1", expectedVersion: 4 });
  });

  it("never surfaces BOOKING_ALREADY_ASSIGNED when details are missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(409, { error: { code: "BOOKING_ALREADY_ASSIGNED", message: "x" } })),
    );
    const e = await performBookingAssignmentMutation(fresh, "r1").catch((x) => x);
    expect(e).toBeInstanceOf(AllocationMutationError);
    expect(e.code).toBe("STALE_VERSION");
    expect(isStaleVersionError(e)).toBe(true);
  });

  it("throws Greek errors for server and network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(409, { error: { code: "CONFLICT_ASSIGNMENT", message: "Room overlap" } })),
    );
    const e = await performBookingAssignmentMutation(assigned, "r2").catch((x) => x);
    expect(e).toBeInstanceOf(AllocationMutationError);
    expect(e.code).toBe("CONFLICT_ASSIGNMENT");
    expect(e.message).toBe("Το διαμέρισμα είναι ήδη κλεισμένο εκείνες τις μέρες.");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const n = await performBookingAssignmentMutation(fresh, "r1").catch((x) => x);
    expect(n).toBeInstanceOf(AllocationMutationError);
    expect(n.message).toBe(GENERIC);
  });
});

describe("applyBookingSuggestionMutation", () => {
  it("throws AllocationMutationError on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(422, { error: { code: "ROOM_INACTIVE", message: "x" } })),
    );
    const e = await applyBookingSuggestionMutation("b1", "r1", 0).catch((x) => x);
    expect(e).toBeInstanceOf(AllocationMutationError);
    expect(e.message).toBe("Αυτό το διαμέρισμα είναι απενεργοποιημένο.");
  });
});
