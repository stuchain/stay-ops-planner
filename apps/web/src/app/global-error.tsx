"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import "@/ui/theme.css";

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
        <div data-ui="new" className="flex min-h-screen items-center justify-center p-6" role="alert">
          <div className="bg-surface text-text rounded-card shadow-card flex w-full max-w-lg flex-col gap-4 p-8">
            <h1 className="text-xl font-semibold">Κάτι πήγε στραβά · Something went wrong</h1>
            <p className="text-text-muted text-base">
              Δοκιμάστε ξανά. Αν συνεχίσει, ενημερώστε τον Στέλιο. · Please try again.
            </p>
            {error.digest ? (
              <p className="text-text-muted text-sm">
                Κωδικός · Reference: <code>{error.digest}</code>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => reset()}
                className="min-h-button bg-accent border-accent rounded-sm border px-6 text-base font-semibold text-white"
              >
                Δοκιμάστε ξανά · Try again
              </button>
              {/* A plain link: the router may be the thing that broke. */}
              <a
                href="/app"
                className="min-h-button border-border bg-surface inline-flex items-center rounded-sm border px-6 text-base font-semibold"
              >
                Αρχική · Home
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
