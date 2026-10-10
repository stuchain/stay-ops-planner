"use client";

import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";
import type { ReactNode } from "react";
import { motion } from "@/ui/tokens";

export type ToastTone = "neutral" | "success" | "warning" | "danger";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ShowToastOptions {
  message: ReactNode;
  tone?: ToastTone;
  action?: ToastAction;
  durationMs?: number;
  /** Extra line under the message (amber for warnings). */
  detail?: ReactNode;
}

const toneClass: Record<ToastTone, string> = {
  neutral: "bg-surface text-text border-border",
  success: "bg-success-soft text-success-text border-success",
  warning: "bg-warning-soft text-warning-text border-warning",
  danger: "bg-danger-soft text-text border-danger",
};

/** Shows a toast and returns its id. */
export function showToast({
  message,
  tone = "neutral",
  action,
  durationMs = 6000,
  detail,
}: ShowToastOptions): string | number {
  return sonnerToast(message, {
    duration: durationMs,
    description: detail,
    className: toneClass[tone],
    action: action
      ? {
          label: action.label,
          onClick: () => action.onClick(),
        }
      : undefined,
  });
}

export interface UndoToastOptions {
  message: ReactNode;
  onUndo: () => void;
  /** Amber warning line, e.g. the over-capacity case. */
  warning?: ReactNode;
  undoLabel?: string;
}

/** "Μετακινήθηκε στο Cosmos · Αναίρεση", visible for 10 seconds. */
export function undoToast({ message, onUndo, warning, undoLabel = "Αναίρεση" }: UndoToastOptions): string | number {
  return showToast({
    message,
    tone: warning ? "warning" : "neutral",
    detail: warning,
    durationMs: motion.undoMs,
    action: { label: undoLabel, onClick: onUndo },
  });
}

export function dismissToast(id?: string | number): void {
  sonnerToast.dismiss(id);
}

/** Render once inside the new shell. Bottom-centre, announced politely. */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      visibleToasts={3}
      containerAriaLabel="Ειδοποιήσεις"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "pointer-events-auto flex w-full min-w-80 items-center gap-4 rounded-card border-2 px-5 py-4 text-base shadow-raised",
          content: "flex-1",
          title: "font-medium",
          description: "text-sm font-medium",
          actionButton:
            "h-target min-w-target shrink-0 cursor-pointer rounded-sm bg-accent px-4 text-base font-semibold text-surface",
        },
      }}
    />
  );
}
