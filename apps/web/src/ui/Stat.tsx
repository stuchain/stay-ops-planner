import type { ReactNode } from "react";
import { cn } from "@/ui/cn";

export type StatTone = "neutral" | "success" | "warning" | "danger";

const toneClasses: Record<StatTone, string> = {
  neutral: "bg-surface text-text",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger",
};

export interface StatProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  className?: string;
}

export function Stat({ label, value, hint, tone = "neutral", className }: StatProps) {
  return (
    <div className={cn("rounded-card shadow-card flex flex-col gap-1 p-5", toneClasses[tone], className)}>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-2xl font-bold">{value}</span>
      {hint ? <span className="text-xs">{hint}</span> : null}
    </div>
  );
}
