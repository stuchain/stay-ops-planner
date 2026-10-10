import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/ui/cn";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  /** Slot at the end of the header, e.g. a button. */
  actions?: ReactNode;
}

export function Card({ title, actions, className, children, ...rest }: CardProps) {
  return (
    <section
      className={cn("bg-surface text-text rounded-card shadow-card flex flex-col gap-4 p-5", className)}
      {...rest}
    >
      {title || actions ? (
        <header className="min-h-target flex items-center justify-between gap-3">
          {title ? <h3 className="text-lg font-semibold">{title}</h3> : <span />}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
