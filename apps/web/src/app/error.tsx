"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { FriendlyError } from "@/features/errors/FriendlyError";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: "app_root" }, extra: { digest: error.digest } });
  }, [error]);
  return <FriendlyError kind="error" onRetry={reset} />;
}
