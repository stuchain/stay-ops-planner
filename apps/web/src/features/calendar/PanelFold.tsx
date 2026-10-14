"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/ui/cn";

export type PanelFoldProps = {
  /** The row's text, such as "Στείλτε μήνυμα". */
  label: ReactNode;
  /** Kept open (clicking the row does nothing), e.g. while the edit form inside has unsaved changes. */
  locked?: boolean;
  testId?: string;
  children: ReactNode;
};

/**
 * One closed row of the booking panel that opens on click. What is inside is drawn only once the row was first
 * opened, and stays drawn when it is closed again, so a half-written text is not lost.
 */
export function PanelFold({ label, locked = false, testId, children }: PanelFoldProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const shown = open || locked;
  return (
    <div className="border-border border-t" data-testid={testId}>
      <h3 className="text-base font-semibold">
        <button
          type="button"
          id={`${id}-button`}
          aria-expanded={shown}
          aria-controls={`${id}-body`}
          onClick={() => {
            if (locked && shown) return;
            setSeen(true);
            setOpen(!shown);
          }}
          className="min-h-button hover:bg-surface-muted -mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-sm px-2 text-left"
        >
          <span className="min-w-0 flex-1">{label}</span>
          <ChevronDown
            size={24}
            aria-hidden="true"
            className={cn("text-text-muted flex-none transition-transform", shown && "rotate-180")}
          />
        </button>
      </h3>
      <section
        id={`${id}-body`}
        aria-labelledby={`${id}-button`}
        hidden={!shown}
        // The theme has no CSS reset, so `hidden` alone would lose to `flex`.
        className={shown ? "flex flex-col gap-3 pt-1 pb-4" : "hidden"}
      >
        {seen || shown ? children : null}
      </section>
    </div>
  );
}
