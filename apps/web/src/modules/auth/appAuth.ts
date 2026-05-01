import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { verifyAndLoadAuthContext } from "./guard";
import { rolesForAppPolicy, type AppPolicyKey } from "./rbac";
import { SESSION_COOKIE_NAME } from "./session";

function loginRedirectUrl(): string {
  return "/login";
}

/**
 * Server component guard for `/app` routes. Uses DB-backed role (same as API `requireSession`).
 */
export async function requireAppPolicy(policyKey: AppPolicyKey) {
  const allowed = rolesForAppPolicy(policyKey);
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  const ctx = await verifyAndLoadAuthContext(token);
  if (!ctx) {
    redirect(loginRedirectUrl());
  }
  if (!allowed.includes(ctx.role)) {
    notFound();
  }
  return ctx;
}
