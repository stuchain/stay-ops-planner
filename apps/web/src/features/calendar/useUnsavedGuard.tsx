"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Button } from "@/ui/Button";

/**
 * Asks before anything that would lose unsaved changes. `run(action)` does the action at once
 * when nothing is unsaved, otherwise it waits for the person's answer. The browser asks too
 * when the tab is closed or the page is left.
 */
export function useUnsavedGuard(): {
  /** Called by the form whenever it has (or no longer has) unsaved changes. */
  setDirty: (dirty: boolean) => void;
  run: (action: () => void) => void;
  dialog: ReactElement;
} {
  const t = useTranslations("bookingEdit");
  const dirty = useRef(false);
  const [pending, setPending] = useState<(() => void) | null>(null);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const setDirty = useCallback((next: boolean) => {
    dirty.current = next;
  }, []);

  const run = useCallback((action: () => void) => {
    if (dirty.current) setPending(() => action);
    else action();
  }, []);

  const dialog = (
    <Dialog.Root open={pending !== null} onOpenChange={(open) => (open ? undefined : setPending(null))}>
      <Dialog.Portal
        container={
          typeof document === "undefined" ? undefined : (document.getElementById("new-ui-root") ?? document.body)
        }
      >
        <Dialog.Overlay className="bg-text/40 fixed inset-0 z-[60]" />
        <Dialog.Content
          role="alertdialog"
          className="bg-surface text-text rounded-card shadow-raised fixed top-1/2 left-1/2 z-[70] flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 p-6"
        >
          <Dialog.Title className="text-lg font-semibold">{t("unsavedTitle")}</Dialog.Title>
          <Dialog.Description className="text-base text-text-muted">{t("unsavedBody")}</Dialog.Description>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" size="lg" onClick={() => setPending(null)} autoFocus>
              {t("stay")}
            </Button>
            <Button
              size="lg"
              onClick={() => {
                const action = pending;
                dirty.current = false;
                setPending(null);
                action?.();
              }}
            >
              {t("discard")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );

  return { setDirty, run, dialog };
}
