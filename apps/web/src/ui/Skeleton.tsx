import { cn } from "@/ui/cn";

export type SkeletonVariant = "line" | "block" | "bar";

const variantClasses: Record<SkeletonVariant, string> = {
  line: "h-4 w-full rounded-sm",
  block: "h-32 w-full rounded-card",
  bar: "h-8 w-full rounded-pill",
};

export interface SkeletonProps {
  variant?: SkeletonVariant;
  className?: string;
}

/** Pulse placeholder. Hidden from assistive tech; the pulse stops under reduced motion. */
export function Skeleton({ variant = "line", className }: SkeletonProps) {
  return (
    <div aria-hidden="true" className={cn("bg-border motion-safe:animate-pulse", variantClasses[variant], className)} />
  );
}
