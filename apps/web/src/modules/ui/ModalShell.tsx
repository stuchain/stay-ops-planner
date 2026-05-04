"use client";

import { useCallback, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlayAccessibility } from "./useOverlayAccessibility";

export type ModalShellPlacement = "drawer-end" | "center";

export type ModalShellProps = {
  open: boolean;
  placement?: ModalShellPlacement;
  title: string;
  titleId?: string;
  busy?: boolean;
  headerActions?: ReactNode;
  /** Called on backdrop click when not busy */
  onRequestClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra panel class (e.g. wide dry-run) */
  panelClassName?: string;
  /** Skip `inert` on `#ops-app-root` when absent (e.g. Storybook / unit tests). */
  useAppShellInert?: boolean;
};

export function ModalShell({
  open,
  placement = "drawer-end",
  title,
  titleId: titleIdProp,
  busy = false,
  headerActions,
  onRequestClose,
  children,
  footer,
  panelClassName = "",
  useAppShellInert = true,
}: ModalShellProps) {
  const autoId = useId();
  const titleId = titleIdProp ?? `ops-modal-title-${autoId}`;
  const panelRef = useRef<HTMLDivElement>(null);

  const onBackdropClick = useCallback(() => {
    if (!busy) onRequestClose();
  }, [busy, onRequestClose]);

  useOverlayAccessibility({
    open,
    busy,
    panelRef,
    onRequestClose,
    useInert: useAppShellInert,
  });

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const header = (
    <header className="ops-drawer-header">
      <h2 id={titleId}>{title}</h2>
      {headerActions}
    </header>
  );

  const body = (
    <>
      {header}
      {children}
      {footer ? <div className="ops-modal-actions">{footer}</div> : null}
    </>
  );

  const tree =
    placement === "center" ? (
      <div className="ops-modal-backdrop" role="presentation" onClick={onBackdropClick}>
        <div
          ref={panelRef}
          className={`ops-modal ${panelClassName}`.trim()}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(ev) => ev.stopPropagation()}
        >
          {body}
        </div>
      </div>
    ) : (
      <div className="ops-drawer-backdrop" role="presentation" onClick={onBackdropClick}>
        <div
          ref={panelRef}
          className={`ops-drawer ${panelClassName}`.trim()}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(ev) => ev.stopPropagation()}
        >
          {body}
        </div>
      </div>
    );

  return createPortal(tree, document.body);
}
