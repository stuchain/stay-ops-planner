import type { ReactNode } from "react";
import { cn } from "@/ui/cn";

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-hand slot for buttons. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-center justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-text text-xl font-semibold">{title}</h1>
        {subtitle ? <p className="text-text-muted text-base">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
