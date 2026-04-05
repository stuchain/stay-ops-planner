import type { StayConflict } from "@stay-ops/db";
import { AllocationError } from "./errors";

export function toDateOnlyIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function throwIfStayConflict(conflict: StayConflict | null): void {
  if (!conflict) return;
  const isAssignment = conflict.kind === "assignment";
  throw new AllocationError({
    code: isAssignment ? "CONFLICT_ASSIGNMENT" : "CONFLICT_BLOCK",
    status: 409,
    message: isAssignment ? "Room overlap detected" : "Overlaps an existing maintenance block",
    details: {
      conflictType: isAssignment ? "assignment" : "maintenance_block",
      conflictId: conflict.id,
      roomId: conflict.roomId,
      startDate: toDateOnlyIso(conflict.startDate),
      endDate: toDateOnlyIso(conflict.endDate),
    },
  });
}
