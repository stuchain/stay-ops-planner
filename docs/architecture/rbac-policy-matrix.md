# RBAC policy matrix (Epic 4)

Roles are persisted on `users.role`: `viewer`, `operator` (default), `admin`.

- **401 `UNAUTHORIZED`**: missing/invalid session or inactive user (from `requireSession` and middleware).
- **403 `FORBIDDEN`**: authenticated but role not allowed for the route/page.
- **Correlation**: JSON envelope `error.traceId` matches `x-request-id` on auth error responses (`respondAuthError` / `apiError`).

## App routes (`/app/*`)

| Path | Roles |
|------|--------|
| `/app/*` (shell: calendar, cleaning, bookings, excel, settings, dashboard, audit, …) | `operator`, `admin` |

Server enforcement: `apps/web/src/app/app/layout.tsx` (`requireAppPolicy("app_shell")`).

## HTTP APIs

Authoritative prefix list: `apps/web/src/modules/auth/rbac.ts` → `API_POLICY_RULES`.

| Prefix | Roles |
|--------|--------|
| `/api/admin/*` | `admin` |
| `/api/sync/hosthub/webhook` `POST` | Public (no session); **signature + secret** enforced in handler (`hosthubWebhook.ts`) |
| `/api/sync/*` (other) | `operator`, `admin` |
| `/api/cleaning/*` | `operator`, `admin` |

**Not in matrix** (handled per-route): `/api/auth/login`, `/api/health/*`, etc.

## Webhook hardening

- **Non-development**: missing `WEBHOOK_SECRET` → **503** `WEBHOOK_NOT_CONFIGURED`; signature always validated when secret is set.
- **Development**: if `WEBHOOK_SECRET` is unset, signature check is skipped (local convenience); if set, signature is validated.

## Operational notes

- Session JWT embeds `role` for correlation; **API and `/app` authorization load role from the database** via `verifyAndLoadAuthContext` so permission changes apply on the next request (not only at next login).
- After changing `users.role`, clients should **refresh `/api/auth/me` or re-login** so UI that caches `user.role` stays aligned.
