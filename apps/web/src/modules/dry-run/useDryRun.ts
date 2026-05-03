"use client";

import { useCallback, useState } from "react";
import type { DryRunResult } from "@stay-ops/shared";

export type DryRunHookState = "idle" | "previewing" | "executing" | "error";

export type UseDryRunOptions<TInput extends Record<string, unknown>> = {
  url: string;
  /** Partial body; the hook adds `dryRun: true|false`. */
  buildBody?: (input: TInput) => Record<string, unknown>;
  /**
   * When true, preview uses `POST ${url}?dryRun=true` with no body (reconcile route).
   */
  dryRunQueryParam?: boolean;
};

function readSummary(data: unknown): DryRunResult {
  const d = data as { dryRun?: boolean; summary?: DryRunResult };
  if (!d?.dryRun || !d.summary) {
    throw new Error("Invalid dry-run response");
  }
  return d.summary;
}

export function useDryRun<TInput extends Record<string, unknown> = Record<string, never>>(
  opts: UseDryRunOptions<TInput>,
) {
  const [state, setState] = useState<DryRunHookState>("idle");
  const [error, setError] = useState<string | null>(null);

  const preview = useCallback(
    async (input?: TInput) => {
      setState("previewing");
      setError(null);
      const inp = (input ?? {}) as TInput;
      let urlTo = opts.url;
      const init: RequestInit = { method: "POST", credentials: "include" };
      if (opts.dryRunQueryParam) {
        urlTo = `${opts.url}?dryRun=true`;
      } else {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify({
          ...(opts.buildBody?.(inp) ?? {}),
          dryRun: true,
        });
      }
      const res = await fetch(urlTo, init);
      const j = (await res.json().catch(() => null)) as { data?: unknown; error?: { message?: string } } | null;
      if (!res.ok) {
        const msg = j?.error?.message ?? `HTTP ${res.status}`;
        setState("error");
        setError(msg);
        throw new Error(msg);
      }
      const summary = readSummary((j as { data?: unknown })?.data);
      setState("idle");
      return summary;
    },
    [opts.url, opts.buildBody, opts.dryRunQueryParam], // eslint-disable-line react-hooks/exhaustive-deps -- stable opts from caller
  );

  const execute = useCallback(
    async (input?: TInput) => {
      setState("executing");
      setError(null);
      const inp = (input ?? {}) as TInput;
      const init: RequestInit = { method: "POST", credentials: "include" };
      if (opts.dryRunQueryParam) {
        // execute: real reconcile, no query / no body
      } else {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify({
          ...(opts.buildBody?.(inp) ?? {}),
          dryRun: false,
        });
      }
      const res = await fetch(opts.url, init);
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (j as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
        setState("error");
        setError(msg);
        throw new Error(msg);
      }
      setState("idle");
      return j;
    },
    [opts.url, opts.buildBody, opts.dryRunQueryParam], // eslint-disable-line react-hooks/exhaustive-deps -- stable opts from caller
  );

  return { preview, execute, state, error };
}
