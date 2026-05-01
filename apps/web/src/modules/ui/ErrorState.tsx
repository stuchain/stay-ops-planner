"use client";

import Link from "next/link";

export type ErrorStateProps = {
  title?: string;
  description?: string;
  /** Correlation id (e.g. Next.js digest or API traceId). */
  traceId?: string | null;
  onRetry?: () => void;
  /** Primary navigation link target (default: calendar). */
  homeHref?: string;
};

export function ErrorState({
  title = "Something went wrong",
  description,
  traceId,
  onRetry,
  homeHref = "/app/calendar",
}: ErrorStateProps) {
  return (
    <div className="ops-error-state" role="alert">
      <h1 className="ops-error-state-title">{title}</h1>
      {description ? <p className="ops-error-state-desc">{description}</p> : null}
      {traceId ? (
        <p className="ops-error-state-trace">
          <span className="ops-error-state-trace-label">Reference:</span>{" "}
          <code className="ops-error-state-trace-id">{traceId}</code>
        </p>
      ) : null}
      <div className="ops-error-state-actions">
        {onRetry ? (
          <button type="button" className="ops-btn ops-btn-primary" onClick={onRetry}>
            Try again
          </button>
        ) : null}
        <Link className="ops-btn" href={homeHref}>
          Back to Calendar
        </Link>
      </div>
    </div>
  );
}
