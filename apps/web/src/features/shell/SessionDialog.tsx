"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { useTRPC } from "@/api/client";
import { clearOfflineCache } from "@/api/offlineCache";
import { askToSignInEarly, sessionGateState, signedIn, signInDismissed, subscribeSessionGate } from "@/api/sessionGate";
import { Button } from "@/ui/Button";

/** How long before the 12-hour end the person is asked to sign in again. */
export const WARN_BEFORE_END_MS = 5 * 60 * 1000;

type Problem = "wrong" | "locked" | "offline" | null;

function portalContainer(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  return document.getElementById("new-ui-root") ?? document.body;
}

/** Asks the server to sign in; the session cookie comes back on the response. */
async function signIn(
  email: string,
  password: string,
): Promise<{ ok: true; email: string } | { ok: false; problem: Problem; minutes?: number }> {
  let response: Response;
  try {
    response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, problem: "offline" };
  }
  if (response.ok) {
    const body = (await response.json().catch(() => null)) as { data?: { user?: { email?: string } } } | null;
    return { ok: true, email: body?.data?.user?.email ?? email };
  }
  if (response.status === 429) {
    const seconds = Number(response.headers.get("Retry-After"));
    return { ok: false, problem: "locked", ...(seconds > 0 ? { minutes: Math.ceil(seconds / 60) } : {}) };
  }
  return { ok: false, problem: "wrong" };
}

/**
 * Signing in again without leaving the page (E2-1). It opens when a request finds the session has run out (that
 * request then runs again) and 5 minutes before the 12-hour end of the login.
 */
export function SessionDialog() {
  const t = useTranslations("session.signIn");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const gate = useSyncExternalStore(subscribeSessionGate, sessionGateState, sessionGateState);
  const me = useQuery(trpc.me.get.queryOptions());
  const knownEmail = me.data?.email ?? "";
  const endsAt = me.data?.sessionEndsAt ?? null;
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<Problem>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!endsAt) return;
    const delay = new Date(endsAt).getTime() - WARN_BEFORE_END_MS - Date.now();
    if (new Date(endsAt).getTime() <= Date.now()) return;
    const timer = window.setTimeout(askToSignInEarly, Math.max(0, delay));
    return () => window.clearTimeout(timer);
  }, [endsAt]);

  useEffect(() => {
    if (!gate.open) return;
    setEmail((current) => current || knownEmail);
    setPassword("");
    setProblem(null);
  }, [gate.open, knownEmail]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email || !password) return setProblem("wrong");
    setBusy(true);
    const result = await signIn(email.trim(), password);
    setBusy(false);
    if (!result.ok) {
      setMinutes(result.minutes ?? null);
      return setProblem(result.problem);
    }
    if (knownEmail && result.email.toLowerCase() !== knownEmail.toLowerCase()) {
      // Someone else signed in: start the app over for them rather than finish the other person's work.
      clearOfflineCache();
      window.location.assign("/app");
      return;
    }
    setPassword("");
    signedIn();
    void queryClient.invalidateQueries(trpc.me.get.queryFilter());
  }

  const problemText =
    problem === "wrong"
      ? t("wrong")
      : problem === "offline"
        ? t("offline")
        : problem === "locked"
          ? minutes
            ? t("lockedMinutes", { count: minutes })
            : t("locked")
          : null;

  return (
    <Dialog.Root
      open={gate.open}
      onOpenChange={(open) => {
        if (!open) signInDismissed();
      }}
    >
      <Dialog.Portal container={portalContainer()}>
        <Dialog.Overlay className="bg-text/40 fixed inset-0 z-50" />
        <Dialog.Content
          className="bg-surface text-text shadow-raised border-border fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-md border p-6"
          onInteractOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title className="text-xl font-semibold">
            {gate.reason === "ending" ? t("endingTitle") : t("expiredTitle")}
          </Dialog.Title>
          <Dialog.Description className="text-text-muted mt-1 text-base">
            {gate.reason === "ending" ? t("endingText") : t("expiredText")}
          </Dialog.Description>
          <form onSubmit={(event) => void submit(event)} className="mt-5 flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1">
              <label htmlFor={emailId} className="text-base font-medium">
                {t("email")}
              </label>
              <input
                id={emailId}
                type="email"
                value={email}
                autoComplete="username"
                onChange={(e) => setEmail(e.target.value)}
                className="min-h-button border-border bg-surface text-text w-full rounded-sm border-2 px-4 text-base"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={passwordId} className="text-base font-medium">
                {t("password")}
              </label>
              <input
                id={passwordId}
                type="password"
                value={password}
                autoComplete="current-password"
                autoFocus
                onChange={(e) => setPassword(e.target.value)}
                className="min-h-button border-border bg-surface text-text w-full rounded-sm border-2 px-4 text-base"
              />
            </div>
            {problemText ? (
              <p role="alert" className="bg-danger-soft text-text rounded-sm p-4 text-base font-medium">
                {problemText}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                icon={LogIn}
                loading={busy}
                loadingLabel={t("signingIn")}
              >
                {t("submit")}
              </Button>
              <Dialog.Close asChild>
                <Button variant="ghost" size="lg">
                  {gate.reason === "ending" ? t("later") : t("cancel")}
                </Button>
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
