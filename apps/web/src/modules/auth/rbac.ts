import type { SessionRole } from "./session";

export type Role = SessionRole;

export type ApiPolicyEntry = {
  /** Longest-prefix wins when multiple entries match. */
  prefix: string;
  methods: readonly string[] | "*";
  roles: readonly Role[];
};

/**
 * Central RBAC matrix for HTTP APIs (source of truth for docs + integration matrix tests).
 * Handlers still call `requireAdminSession` / `requireOperatorOrAdmin` explicitly; keep this list aligned.
 */
export const API_POLICY_RULES: readonly ApiPolicyEntry[] = [
  { prefix: "/api/admin", methods: "*", roles: ["admin"] },
  { prefix: "/api/sync/hosthub/webhook", methods: ["POST"], roles: [] }, // public; signature enforced in handler
  { prefix: "/api/sync", methods: "*", roles: ["operator", "admin"] },
  { prefix: "/api/cleaning", methods: "*", roles: ["operator", "admin"] },
] as const;

function methodMatches(rule: ApiPolicyEntry, method: string): boolean {
  const m = method.toUpperCase();
  if (rule.methods === "*") return true;
  return rule.methods.includes(m);
}

/** Longest matching prefix wins. Returns empty roles array for explicitly public rules (e.g. webhook). */
export function resolveApiPolicy(method: string, pathname: string): readonly Role[] | null {
  const upper = method.toUpperCase();
  let best: ApiPolicyEntry | null = null;
  for (const rule of API_POLICY_RULES) {
    if (!pathname.startsWith(rule.prefix)) continue;
    if (!methodMatches(rule, upper)) continue;
    if (!best || rule.prefix.length > best.prefix.length) {
      best = rule;
    }
  }
  return best ? [...best.roles] : null;
}

export type AppPolicyKey = "app_shell";

const APP_POLICY: Record<AppPolicyKey, readonly Role[]> = {
  app_shell: ["operator", "admin"],
};

export function rolesForAppPolicy(key: AppPolicyKey): readonly Role[] {
  return APP_POLICY[key];
}

/** Map pathname (with or without query) to required roles for server-rendered `/app` pages. */
export function resolveAppPolicy(pathname: string): { key: AppPolicyKey; roles: readonly Role[] } {
  const path = pathname.split("?")[0] ?? pathname;
  if (path.startsWith("/app")) {
    return { key: "app_shell", roles: rolesForAppPolicy("app_shell") };
  }
  return { key: "app_shell", roles: rolesForAppPolicy("app_shell") };
}
