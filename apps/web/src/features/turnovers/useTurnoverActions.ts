"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { TurnoverTask } from "@/api/types";
import { showToast, undoToast } from "@/ui/Toast";

export type TurnoverActions = {
  /** The id of the cleaning a change is being saved for, or null. */
  busyId: string | null;
  setStatus: (task: TurnoverTask, status: "todo" | "in_progress" | "done") => Promise<boolean>;
  /** Removes an A or an S in one click and offers Undo (Stelios, 2026-10-14). */
  remove: (task: TurnoverTask) => Promise<void>;
};

/**
 * The changes a person can make to a cleaning. Each one carries the version they were looking at; when the
 * server says it changed meanwhile (or anything else), the person is told and the list is read again.
 */
export function useTurnoverActions(): TurnoverActions {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const t = useTranslations("cleaningCalendar");
  const tCommon = useTranslations("common");
  // The list and the calendar both show cleanings.
  const listKey = trpc.cleaning.pathKey();
  const refresh = () => queryClient.invalidateQueries({ queryKey: listKey });

  const options = { meta: { handlesErrors: true }, onSettled: () => void refresh() };
  const status = useMutation({ ...trpc.cleaning.setStatus.mutationOptions(), ...options });
  const removal = useMutation({ ...trpc.cleaning.remove.mutationOptions(), ...options });
  const restore = useMutation({ ...trpc.cleaning.restore.mutationOptions(), ...options });

  async function attempt(work: () => Promise<unknown>): Promise<boolean> {
    try {
      await work();
      return true;
    } catch (error) {
      showToast({ message: errorText(error), tone: "danger" });
      return false;
    }
  }

  async function remove(task: TurnoverTask): Promise<void> {
    try {
      const { version } = await removal.mutateAsync({ id: task.id, expectedVersion: task.version });
      undoToast({
        message: t("detail.removed"),
        undoLabel: tCommon("undo"),
        onUndo: () =>
          void restore
            .mutateAsync({ id: task.id, expectedVersion: version })
            .then(() => showToast({ message: t("detail.restored"), tone: "success" }))
            .catch((error: unknown) => showToast({ message: errorText(error), tone: "danger" })),
      });
    } catch (error) {
      showToast({ message: errorText(error), tone: "danger" });
    }
  }

  const busyId =
    (status.isPending ? status.variables?.id : undefined) ??
    (removal.isPending ? removal.variables?.id : undefined) ??
    null;

  return {
    busyId,
    setStatus: (task, next) =>
      attempt(() => status.mutateAsync({ id: task.id, expectedVersion: task.version, status: next })),
    remove,
  };
}
