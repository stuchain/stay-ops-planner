import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="ops-login-main">
      <Suspense fallback={<p className="ops-muted">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
