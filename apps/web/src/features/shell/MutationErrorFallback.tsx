"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useErrorText } from "@/api/errors";
import { needsFallbackMessage } from "@/api/mutationErrors";
import { showToast } from "@/ui/Toast";

/** Safety net: a save that fails without its own error handling still tells the person, never fails silently. */
export function MutationErrorFallback() {
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "error") return;
        if (needsFallbackMessage(event.mutation, event.action.error)) {
          showToast({ message: errorText(event.action.error), tone: "danger" });
        }
      }),
    [queryClient, errorText],
  );
  return null;
}
