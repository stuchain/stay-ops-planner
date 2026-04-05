"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/app/calendar";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "Login failed");
        return;
      }
      router.push(next.startsWith("/") ? next : "/app/calendar");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="ops-login-form" onSubmit={onSubmit}>
      <h1>Stay Ops Planner</h1>
      <p className="ops-muted">Sign in to continue.</p>
      <label className="ops-label">
        Email
        <input
          className="ops-input"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          required
        />
      </label>
      <label className="ops-label">
        Password
        <input
          className="ops-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(ev) => setPassword(ev.target.value)}
          required
        />
      </label>
      {error && <p className="ops-error">{error}</p>}
      <button type="submit" className="ops-btn ops-btn-primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
