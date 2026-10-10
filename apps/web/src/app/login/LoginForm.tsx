"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent } from "react";
import { safeNextPath } from "./safeNextPath";

type ApiBody = { error?: { code?: string; details?: { retryAfterSeconds?: number } } } | null;

/** Whole minutes to wait, at least one. */
export function waitMinutes(retryAfterSeconds: number | undefined): number {
  return Math.max(1, Math.ceil((retryAfterSeconds ?? 60) / 60));
}

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function LoginForm() {
  const t = useTranslations("login");
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const online = useOnline();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formId = useId();
  const emailId = `${formId}-email`;
  const passwordId = `${formId}-password`;
  const errorId = `${formId}-error`;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!navigator.onLine) {
      setError(t("offline"));
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const json = (await res.json().catch(() => null)) as ApiBody;
      if (!res.ok) {
        const code = json?.error?.code;
        if (code === "RATE_LIMITED") {
          setError(t("locked", { minutes: waitMinutes(json?.error?.details?.retryAfterSeconds) }));
        } else if (code === "INVALID_CREDENTIALS") {
          setError(t("wrongCredentials"));
        } else if (code === "ACCOUNT_DISABLED") {
          setError(t("disabled"));
        } else {
          setError(t("failed"));
        }
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      // The request never reached the server.
      setError(t("offline"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="ops-login-form" onSubmit={onSubmit}>
      <h1>{t("title")}</h1>
      <p className="ops-muted">{t("subtitle")}</p>
      {online ? null : (
        <p className="ops-error" role="status" data-testid="login-offline">
          {t("offline")}
        </p>
      )}
      <div className="ops-label">
        <label htmlFor={emailId}>{t("email")}</label>
        <input
          id={emailId}
          data-testid="login-email"
          className="ops-input"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </div>
      <div className="ops-label">
        <label htmlFor={passwordId}>{t("password")}</label>
        <input
          id={passwordId}
          data-testid="login-password"
          className="ops-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(ev) => setPassword(ev.target.value)}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </div>
      {error ? (
        <p id={errorId} className="ops-error" role="alert" data-testid="login-error">
          {error}
        </p>
      ) : null}
      <button type="submit" data-testid="login-submit" className="ops-btn ops-btn-primary" disabled={pending}>
        {pending ? t("signingIn") : t("signIn")}
      </button>
    </form>
  );
}
