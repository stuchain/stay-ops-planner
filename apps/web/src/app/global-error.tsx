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

  // The whole app failed, so translations are not available: Greek first, English under it.
  return (
    <html lang="el">
      <body>
        <div className="ops-error-boundary-root">
          <ErrorState
            title="Κάτι πήγε στραβά · Something went wrong"
            description="Δοκιμάστε ξανά. Αν συνεχίσει, ενημερώστε τον Στέλιο. · Please try again."
            traceId={error.digest}
            onRetry={() => reset()}
          />
        </div>
      </body>
    </html>
  );
}
