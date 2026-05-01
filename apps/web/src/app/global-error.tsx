"use client";

import { useEffect } from "react";
import "./globals.css";
import * as Sentry from "@sentry/nextjs";
import { ErrorState } from "@/modules/ui/ErrorState";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { boundary: "global" },
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div className="ops-error-boundary-root">
          <ErrorState
            title="Application error"
            description={error.message || "A critical error occurred."}
            traceId={error.digest}
            onRetry={() => reset()}
          />
        </div>
      </body>
    </html>
  );
}
