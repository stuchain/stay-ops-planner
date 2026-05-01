"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { ErrorState } from "@/modules/ui/ErrorState";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { boundary: "app_root" },
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <div className="ops-error-boundary-root">
      <ErrorState
        title="Something went wrong"
        description={error.message || "An unexpected error occurred."}
        traceId={error.digest}
        onRetry={() => reset()}
      />
    </div>
  );
}
