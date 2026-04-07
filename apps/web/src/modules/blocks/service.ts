import { findStayConflict, PrismaClient } from "@stay-ops/db";
import { throwIfStayConflict } from "../allocation/stayConflict";
import { writeAuditSnapshot } from "@stay-ops/audit";

const prisma = new PrismaClient();

export class BlockNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;

  constructor(public readonly blockId: string) {
    super("Manual block not found");
    this.name = "BlockNotFoundError";
  }
}

export class InvalidBlockRangeError extends Error {
  readonly code = "VALIDATION_ERROR" as const;
  readonly status = 400;

  constructor() {
    super("startDate must be strictly before endDate");
    this.name = "InvalidBlockRangeError";
  }
}

export type CreateManualBlockInput = {
  roomId: string;
  startDate: Date;
  endDate: Date;
  reason?: string | null;
  actorUserId?: string;
  auditMeta?: Record<string, unknown>;
};

export type UpdateManualBlockInput = {
  startDate?: Date;
  endDate?: Date;
  reason?: string | null;
  actorUserId?: string;
  auditMeta?: Record<string, unknown>;
};

export async function createManualBlock(input: CreateManualBlockInput) {
  return prisma.$transaction(async (tx) => {
    throwIfStayConflict(
      await findStayConflict(tx, {
        roomId: input.roomId,
        start: input.startDate,
        end: input.endDate,
      }),
    );
    const created = await tx.manualBlock.create({
      data: {
        roomId: input.roomId,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason ?? null,
      },
    });
    await writeAuditSnapshot(tx, {
      actorUserId: input.actorUserId,
      action: "manual_block.create",
      entityType: "manual_block",
      entityId: created.id,
      before: null,
      after: {
        roomId: created.roomId,
        startDate: created.startDate.toISOString().slice(0, 10),
        endDate: created.endDate.toISOString().slice(0, 10),
        reason: created.reason,
      },
      meta: { roomId: created.roomId, ...(input.auditMeta ?? {}) },
    });
    return created;
  });
}

export async function updateManualBlock(blockId: string, patch: UpdateManualBlockInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.manualBlock.findUnique({ where: { id: blockId } });
    if (!existing) {
      throw new BlockNotFoundError(blockId);
    }

    const start = patch.startDate ?? existing.startDate;
    const end = patch.endDate ?? existing.endDate;

    if (!(start < end)) {
      throw new InvalidBlockRangeError();
    }

    throwIfStayConflict(
      await findStayConflict(tx, {
        roomId: existing.roomId,
        start,
        end,
        excludeBlockId: blockId,
      }),
    );

    const updated = await tx.manualBlock.update({
      where: { id: blockId },
      data: {
        ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
        ...(patch.endDate !== undefined ? { endDate: patch.endDate } : {}),
        ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
      },
    });
    await writeAuditSnapshot(tx, {
      actorUserId: patch.actorUserId,
      action: "manual_block.update",
      entityType: "manual_block",
      entityId: blockId,
      before: {
        roomId: existing.roomId,
        startDate: existing.startDate.toISOString().slice(0, 10),
        endDate: existing.endDate.toISOString().slice(0, 10),
        reason: existing.reason,
      },
      after: {
        roomId: updated.roomId,
        startDate: updated.startDate.toISOString().slice(0, 10),
        endDate: updated.endDate.toISOString().slice(0, 10),
        reason: updated.reason,
      },
      meta: { roomId: updated.roomId, ...(patch.auditMeta ?? {}) },
    });
    return updated;
  });
}

export async function deleteManualBlock(
  blockId: string,
  actorUserId?: string,
  auditMeta?: Record<string, unknown>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.manualBlock.findUnique({ where: { id: blockId } });
    if (!existing) {
      throw new BlockNotFoundError(blockId);
    }
    await tx.manualBlock.delete({ where: { id: blockId } });
    await writeAuditSnapshot(tx, {
      actorUserId,
      action: "manual_block.delete",
      entityType: "manual_block",
      entityId: blockId,
      before: {
        roomId: existing.roomId,
        startDate: existing.startDate.toISOString().slice(0, 10),
        endDate: existing.endDate.toISOString().slice(0, 10),
        reason: existing.reason,
      },
      after: null,
      meta: { roomId: existing.roomId, ...(auditMeta ?? {}) },
    });
  });
}

/** Phase 4 traceability name: delegates to the same transaction helpers as the free functions. */
export class ManualBlockService {
  static create(input: CreateManualBlockInput) {
    return createManualBlock(input);
  }

  static update(blockId: string, patch: UpdateManualBlockInput) {
    return updateManualBlock(blockId, patch);
  }

  static delete(blockId: string, actorUserId?: string, auditMeta?: Record<string, unknown>) {
    return deleteManualBlock(blockId, actorUserId, auditMeta);
  }
}
