import { findStayConflict, PrismaClient } from "@stay-ops/db";
import { throwIfStayConflict } from "../allocation/stayConflict";

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
};

export type UpdateManualBlockInput = {
  startDate?: Date;
  endDate?: Date;
  reason?: string | null;
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
    return tx.manualBlock.create({
      data: {
        roomId: input.roomId,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason ?? null,
      },
    });
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

    return tx.manualBlock.update({
      where: { id: blockId },
      data: {
        ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
        ...(patch.endDate !== undefined ? { endDate: patch.endDate } : {}),
        ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
      },
    });
  });
}

export async function deleteManualBlock(blockId: string): Promise<void> {
  try {
    await prisma.manualBlock.delete({ where: { id: blockId } });
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "P2025") {
      throw new BlockNotFoundError(blockId);
    }
    throw e;
  }
}

/** Phase 4 traceability name: delegates to the same transaction helpers as the free functions. */
export class ManualBlockService {
  static create(input: CreateManualBlockInput) {
    return createManualBlock(input);
  }

  static update(blockId: string, patch: UpdateManualBlockInput) {
    return updateManualBlock(blockId, patch);
  }

  static delete(blockId: string) {
    return deleteManualBlock(blockId);
  }
}
