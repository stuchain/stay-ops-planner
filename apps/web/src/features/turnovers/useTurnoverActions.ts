"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { TurnoverTask } from "@/api/types";
import { showToast } from "@/ui/Toast";

export type TurnoverActions = {
  /** The id of the cleaning a change is being saved for, or null. */
  busyId: string | null;
  setStatus: (task: TurnoverTask, status: "todo" | "in_progress" | "done") => Promise<boolean>;
  setAssignee: (task: TurnoverTask, assigneeName: string | null) => Promise<boolean>;
  reschedule: (task: TurnoverTask, start: string, end: string) => Promise<boolean>;
};

/**
 * The changes a person can make to a cleaning. Each one carries the version they were looking at; when the
 * server says it changed meanwhile (or anything else), the person is told and the list is read again.
 */
export function useTurnoverActions(): TurnoverActions {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const listKey = trpc.cleaning.list.pathKey();

  const options = {
    onSettled: () => void queryClient.invalidateQueries({ queryKey: listKey }),
  };
  const status = useMutation({ ...trpc.cleaning.setStatus.mutationOptions(), ...options });
  const assignee = useMutation({ ...trpc.cleaning.setAssignee.mutationOptions(), ...options });
  const schedule = useMutation({ ...trpc.cleaning.reschedule.mutationOptions(), ...options });

  async function attempt(work: () => Promise<unknown>): Promise<boolean> {
    try {
      await work();
      return true;
    } catch (error) {
      showToast({ message: errorText(error), tone: "danger" });
      return false;
    }
  }

  const busyId =
    (status.isPending ? status.variables?.id : undefined) ??
    (assignee.isPending ? assignee.variables?.id : undefined) ??
    (schedule.isPending ? schedule.variables?.id : undefined) ??
    null;

  return {
    busyId,
    setStatus: (task, next) =>
      attempt(() => status.mutateAsync({ id: task.id, expectedVersion: task.version, status: next })),
    setAssignee: (task, assigneeName) =>
      attempt(() => assignee.mutateAsync({ id: task.id, expectedVersion: task.version, assigneeName })),
    reschedule: (task, start, end) =>
      attempt(() => schedule.mutateAsync({ id: task.id, expectedVersion: task.version, start, end })),
  };
}
