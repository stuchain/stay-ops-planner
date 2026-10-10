"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { cn } from "@/ui/cn";

export interface SidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** false (default): no overlay, the calendar stays visible and usable beside the panel. */
  modal?: boolean;
  closeLabel?: string;
  className?: string;
}

function portalContainer(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  return document.getElementById("new-ui-root") ?? document.body;
}

/** Panel that slides in from the right (420 px; full width on phones). */
export function SidePanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  modal = false,
  closeLabel = "Κλείσιμο",
  className,
}: SidePanelProps) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <Dialog.Portal container={portalContainer()}>
        {modal ? <Dialog.Overlay className="bg-text/40 fixed inset-0 z-40" /> : null}
        <Dialog.Content
          {...(description ? {} : ({ "aria-describedby": undefined } as object))}
          onOpenAutoFocus={() => {
            opener.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
          onInteractOutside={(event) => {
            if (!modal) event.preventDefault();
          }}
          className={cn(
            "bg-surface text-text shadow-raised border-border w-panel fixed inset-y-0 right-0 z-50 flex max-w-full flex-col border-l",
            "max-[759px]:w-full max-[759px]:border-l-0",
            "transition-transform duration-200 ease-out starting:translate-x-full",
            className,
          )}
        >
          <header className="border-border flex items-start gap-3 border-b px-5 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-text-muted text-sm">{description}</Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              aria-label={closeLabel}
              className="text-text hover:bg-surface-muted h-target w-target inline-flex shrink-0 items-center justify-center rounded-sm"
            >
              <X size={24} strokeWidth={2} aria-hidden="true" />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <footer className="border-border border-t px-5 py-4">{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
