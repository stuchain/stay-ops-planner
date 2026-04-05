import { Prisma, PrismaClient } from "@stay-ops/db";
import { CleaningTaskNotFoundError, InvalidStateTransitionError } from "./errors";

const prisma = new PrismaClient();

/** Linear workflow only: todo -> in_progress -> done. */
const NEXT: Record<string, string> = {
  todo: "in_progress",
  in_progress: "done",
};

export type CleaningWorkflowTarget = "in_progress" | "done";

export async function transitionCleaningTaskStatus(params: {
  taskId: string;
  toStatus: CleaningWorkflowTarget;
  actorUserId: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const task = await tx.cleaningTask.findUnique({ where: { id: params.taskId } });
    if (!task) {
      throw new CleaningTaskNotFoundError(params.taskId);
    }

    const from = task.status ?? "todo";

    if (from === "cancelled") {
      throw new InvalidStateTransitionError("Cannot transition from cancelled");
    }
    if (from === "done") {
      throw new InvalidStateTransitionError("Cannot transition from done");
    }

    const allowedNext = NEXT[from];
    if (allowedNext !== params.toStatus) {
      throw new InvalidStateTransitionError(
        `Cannot move from ${from} to ${params.toStatus}`,
      );
    }

    await tx.cleaningTask.update({
      where: { id: params.taskId },
      data: { status: params.toStatus },
    });

    await tx.auditEvent.create({
      data: {
        userId: params.actorUserId,
        action: "cleaning_task.status_changed",
        entityType: "cleaning_task",
        entityId: params.taskId,
        payload: { from, to: params.toStatus } as Prisma.InputJsonValue,
      },
    });
  });
}
