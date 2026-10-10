import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";

export interface ErrorStateProps {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({ message, onRetry, retryLabel = "Δοκιμάστε ξανά", className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("bg-danger-soft text-text rounded-card flex flex-col items-start gap-3 p-5", className)}
    >
      <p className="flex items-start gap-2 text-base font-medium">
        <TriangleAlert size={24} className="text-danger shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </p>
      <Button variant="secondary" icon={RotateCw} onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
