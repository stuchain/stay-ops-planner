"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { getFocusableElements } from "./focusable";
import { pushOverlayInert } from "./overlayInert";

export type UseOverlayAccessibilityOptions = {
  open: boolean;
  /**
   * When false, the overlay stays mounted for inert stacking but does not capture Tab/Escape
   * (e.g. drawer under a nested modal). Defaults to `open`.
   */
  trapActive?: boolean;
  busy?: boolean;
  panelRef: RefObject<HTMLElement | null>;
  onRequestClose: () => void;
  /** When false, skip `inert` on `#ops-app-root` (e.g. Storybook / unit tests). */
  useInert?: boolean;
};

/**
 * Escape-to-close (respects `busy` via ref), document-level Tab focus trap when `trapActive`,
 * initial focus, optional `inert` on the app shell while `open`, and focus restore when `open` becomes false.
 *
 * Declared order: trap effect first, then inert — on unmount/close, inert pops before focus restore (see cleanups).
 */
export function useOverlayAccessibility({
  open,
  trapActive,
  busy = false,
  panelRef,
  onRequestClose,
  useInert = true,
}: UseOverlayAccessibilityOptions): void {
  const trapping = trapActive !== undefined ? trapActive : open;
  const openRef = useRef(open);
  openRef.current = open;
  const busyRef = useRef(!!busy);
  busyRef.current = !!busy;
  const onRequestCloseRef = useRef(onRequestClose);
  onRequestCloseRef.current = onRequestClose;

  useLayoutEffect(() => {
    if (!open || !trapping) return;
    const root = panelRef.current;
    if (!root) return;

    const toRestore =
      document.activeElement instanceof HTMLElement && !root.contains(document.activeElement)
        ? document.activeElement
        : null;

    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const list = getFocusableElements(panel);
      list[0]?.focus();
    });

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        if (!busyRef.current) {
          ev.preventDefault();
          onRequestCloseRef.current();
        }
        return;
      }
      if (ev.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const list = getFocusableElements(panel);
      if (list.length === 0) return;
      if (!panel.contains(document.activeElement)) {
        ev.preventDefault();
        list[0]?.focus();
        return;
      }
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
      queueMicrotask(() => {
        if (!openRef.current) toRestore?.focus?.();
      });
    };
  }, [open, trapping, panelRef]);

  useLayoutEffect(() => {
    if (!open) return;
    const popInert = useInert ? pushOverlayInert() : () => {};
    return () => {
      popInert();
    };
  }, [open, useInert]);
}
