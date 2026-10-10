import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/ui/cn";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  text?: string;
  /** Usually a Button. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, text, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-10 text-center", className)}>
      <span className="bg-accent-soft text-accent flex h-14 w-14 items-center justify-center rounded-full">
        <Icon size={24} aria-hidden="true" />
      </span>
      <h3 className="text-lg font-semibold">{title}</h3>
      {text ? <p className="text-text-muted max-w-prose text-sm">{text}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
