import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * neutral: plain facts ("Δεν έχει γίνει", "Εκτίμηση"); info: where you are ("Σήμερα", "Τώρα");
 * success: done; warning: needs him; danger: something went wrong.
 */
export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-text border-border border",
  info: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger",
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** Optional leading Lucide icon. */
  icon?: LucideIcon;
  /** Greyed with a dashed outline, for something cancelled. Overrides the tone. */
  dashed?: boolean;
  /** md (default): 16 px text; lg: 18 px, for the cleaner's big screen. */
  size?: "md" | "lg";
  /** Layout only (margins, alignment); colours and sizes come from tone and size. */
  className?: string;
  children: ReactNode;
}

/** The one small label: a pill with a word in it, never colour alone. */
export function Badge({ tone = "neutral", icon: Icon, dashed = false, size = "md", className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "rounded-pill inline-flex items-center gap-1 px-3 py-1 leading-tight font-semibold whitespace-nowrap",
        size === "lg" ? "text-base" : "text-sm",
        dashed ? "bg-surface-muted text-text-muted border-border border border-dashed" : toneClasses[tone],
        className,
      )}
    >
      {Icon ? <Icon size={size === "lg" ? 20 : 16} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
