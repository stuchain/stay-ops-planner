"use client";

import { MoreHorizontal, Printer, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { buttonBase, buttonSizes, buttonVariants } from "@/ui/Button";
import { cn } from "@/ui/cn";

const itemClass =
  "min-h-button hover:bg-surface-muted flex w-full items-center gap-3 rounded-sm px-4 text-left text-base font-medium";

/**
 * "Περισσότερα" (⋯) at the end of the calendar's header: Search and Print, which he rarely needs, behind one
 * button. A disclosure: the button says whether it is open, Escape or a click elsewhere closes it.
 */
export function MoreMenu({ onPrint, className }: { onPrint: () => void; className?: string }) {
  const t = useTranslations("calendar");
  const tSearch = useTranslations("search");
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  return (
    <div
      ref={root}
      className={cn("relative", className)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        // Handled here, so the calendar's own Escape (close the booking panel) does not also run.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}
      onBlur={(event) => {
        if (open && !root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        onClick={() => setOpen(!open)}
        className={cn(buttonBase, buttonVariants.secondary, buttonSizes.md)}
      >
        <MoreHorizontal size={20} aria-hidden="true" />
        {t("more")}
      </button>
      {/* Rendered only while open: the theme has no CSS reset, so a `hidden` attribute loses to `flex`. */}
      {open ? (
        <div
          id={`${id}-menu`}
          className="bg-surface border-border shadow-raised rounded-card absolute top-full right-0 z-40 mt-2 flex w-60 flex-col gap-1 border p-2"
        >
          <Link href="/app/search" className={itemClass} onClick={() => setOpen(false)}>
            <Search size={20} aria-hidden="true" />
            {tSearch("open")}
          </Link>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              onPrint();
            }}
          >
            <Printer size={20} aria-hidden="true" />
            {t("print")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
