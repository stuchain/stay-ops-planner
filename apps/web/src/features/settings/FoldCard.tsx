import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A settings card that starts closed: only its heading shows, and a click on it opens the rest. For what is
 * rarely changed (the password, the language), so the screen stays short.
 */
export function FoldCard({ summary, children, testId }: { summary: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <details className="group bg-surface text-text rounded-card shadow-card p-5" data-testid={testId}>
      <summary className="min-h-target flex cursor-pointer list-none items-center justify-between gap-3 text-lg font-semibold [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <ChevronDown size={24} aria-hidden="true" className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-4 pt-4">{children}</div>
    </details>
  );
}
