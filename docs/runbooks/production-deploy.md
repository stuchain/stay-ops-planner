# Production Deployment (Vercel + Neon, no dedicated worker)

This runbook follows the EPICS_2 household ship model: web/API on Vercel, Neon
as shared source of truth, and no separate background worker in production.
Sync runs server-side through protected endpoints with single-flight locking.

## Canonical A1 architecture sentence (verbatim, S1)

Use this exact wording in private operator notes and release summaries ([Ship-Epic S1](../EPICS_2.md)):

> Production runs on Vercel + Neon with no dedicated worker; sync runs from protected web endpoints with DB single-flight locking.

## S1 private operator note template

Copy **only** into private storage (password manager, encrypted note, etc.). Fill the placeholders there; never commit operational notes with personal details.

```
Local date (you):          ________________________________
Owner initials:            ________________________________

Canonical sentence (paste verbatim):

Production runs on Vercel + Neon with no dedicated worker; sync runs from protected web endpoints with DB single-flight locking.

Runbook evidence link — pick one URL you can reopen:
- Repo path from clone root: docs/runbooks/production-deploy.md
- Or GitHub/Git remote (replace placeholders):
  https://github.com/<org>/<repo>/blob/main/docs/runbooks/production-deploy.md

Baseline acknowledgment:

I confirm Redis/BullMQ and packages/worker are NOT part of the household
production ship path for Stay Ops Planner. Sync runs only from protected
web/API endpoints with DB single-flight locking. Local or Docker stacks may
still use the worker package for development; that is intentional and separate
from production baseline.
```

## Locked deployment decisions

- Production host: Vercel (`apps/web`)
- Monorepo build/install commands are pinned in Git for this app:
  [`../../apps/web/vercel.json`](../../apps/web/vercel.json). In Vercel, set **Root Directory**
  to `apps/web` and leave **Install** / **Build** empty in the dashboard so those commands apply.
  (**Dashboard** install/build overrides `vercel.json` if filled in.) Production build runs
  `pnpm build:web`, which builds `@stay-ops/web` and its workspace dependencies only (skips `packages/worker`) and uses pnpm **append-only** output so logs advance while `next build` compiles.
- Deployment trigger: auto-deploy on push/merge to `main`
- Production DB: single Neon Postgres target
- Migration policy: run in deploy pipeline and block release on failure
- Sync trigger model: login debounce + manual + hourly daytime cron
- Overlap policy: return `409` with `sync already running`
- Ship gate approval: you + father

## Environment readiness

Validate the production environment matrix in [../../.env.example](../../.env.example)
before each ship candidate.

### When `/api/health/ready` returns 503 `degraded`

The body includes `checks.db: "error"` plus, when Prisma exposes them, **`checks.prismaCode`** and **`checks.issue`** (`cannot_connect`, `authentication_failed`, `connection_timeout`, etc.). Interpretation hints:

| `issue` / typical code | Likely meaning | What to verify |
|---|---|---|
| `cannot_connect` (often **P1001**) | TCP/TLS/name could not establish | Neon project running (not fully suspended); `DATABASE_URL` host matches Neon’s **pooler** URL if you deploy serverless (Vercel); no typo in hostname/port |
| `connection_timeout` (**P1002**) | Firewall or network stall | Neon/Vercel allowlists; regional latency; try Neon’s pooled string |
| `authentication_failed` (**P1000**) | User/password/database rejected | Rotate Neon role password; URL-encode special characters in the password portion of `DATABASE_URL` |
| `database_does_not_exist` (**P1003**) | DB name in URL wrong | Neon default DB name (`neondb` vs custom) |

Full Prisma messages are emitted to **function logs** (e.g. Vercel → Logs) alongside JSON `readiness_db_check` — never commit connection strings.

### Cross-check locally

Use the **same** `DATABASE_URL` value as Production in your shell (copy from Vercel env UI; never commit it), then:

```bash
pnpm --filter @stay-ops/db exec prisma migrate status
```

If this cannot connect, fix the URL (pooler hostname, SSL, password encoding) before expecting `/api/health/ready` to pass on Vercel.

Required:
- `DATABASE_URL`
- `SESSION_SECRET` (>= 32 chars)
- `APP_TIMEZONE`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`
- Hosthub integration secrets (`HOSTHUB_*`, `WEBHOOK_SECRET`)

Optional but selected baseline:
- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`
- `SENTRY_USER_ID_PEPPER`

Validation reference: [../../packages/shared/src/env.ts](../../packages/shared/src/env.ts)

## Production migrations via GitHub Actions

For EPICS [S2 / S3](../EPICS_2.md) traceability you can apply pending migrations without pasting Neon credentials into CI logs explicitly beyond GitHub-supplied masking:

1. In GitHub: **Settings → Environments → create `production`** (recommended: required reviewers).
2. Add an environment secret **`DATABASE_URL`** on **`production`** with your Neon pooled connection string (same DB Vercel Production uses — see [below](#preview-deployments-and-the-production-database) if Preview shares it too).
3. Actions → **[Migrate production DB](../../.github/workflows/migrate-production.yml)** → **Run workflow** (manual `workflow_dispatch` only).

Steps run `prisma migrate deploy` then **`prisma migrate status`** ([workflow source](../../.github/workflows/migrate-production.yml)). Uses concurrency group `migrate-production` so overlapping dispatch runs do not cancel each other mid-flight.

**Ad-hoc readiness check:** Actions → **[Verify production readiness](../../.github/workflows/verify-production-readiness.yml)** — paste the **full** `https://…/api/health/ready` URL. Set repository secret **`VERCEL_AUTOMATION_BYPASS_SECRET`** if Deployment Protection otherwise returns HTTP 401 (same bypass as [.github/workflows/health-check.yml](../../.github/workflows/health-check.yml)).

You can still run `pnpm --filter @stay-ops/db migrate:deploy` from a trusted machine with Production `DATABASE_URL` instead.

## Preview deployments and the production database

Some teams point **both** Vercel **Production** and **Preview** at the **same Neon `DATABASE_URL`** (minimal household setup). Treat that Neon database as **the** production plane for all those deployments:

- Do **not** run destructive fixtures, **`seed:dev`**, **`migrate:dev`**, or experimental SQL against that URL from preview-only workflows.
- Schema changes remain **`migrate deploy`** only ([migrations.md](migrations.md)); coordinate so only one migration path wins (recommended: GitHub **Migrate production DB** workflow or an approved maintainer CLI run).

If you adopt a dedicated **preview/staging Neon** later, assign a separate `DATABASE_URL` on Vercel **Preview** so branch deploys stop sharing production data risk.

## Operator-only steps (cannot be done from this repository)

These require your accounts, secrets, and browser—there is nothing to “push” for them:

| Step | You do |
|------|--------|
| Neon | Create DB; copy **`DATABASE_URL`**; keep it secret. |
| Vercel | Create/link project → Git repo → Root Directory **`apps/web`** → deploy. **`vercel.json`** supplies install/build commands. |
| Vercel env | Add **`DATABASE_URL`**, **`SESSION_SECRET`** (≥32 chars), **`APP_TIMEZONE`**, plus Hosthub/Sentry when needed (see [.env.example](../../.env.example)). |
| Vercel Git | Confirm **Production Branch** = **`main`**. |
| Schema + users | On a trusted machine, with **`DATABASE_URL`** set to **Neon**: `pnpm --filter @stay-ops/db migrate:deploy` then `pnpm --filter @stay-ops/db seed` (set **`BOOTSTRAP_ADMIN_*`** for seed). Never commit secrets. |

## Deploy order (production)

1. Confirm all required env vars are present in Vercel project settings.
2. Trigger production deploy from `main`.
3. Run migration step before app promotion:
   - `pnpm --filter @stay-ops/db migrate:deploy` **or** GitHub Actions **Migrate production DB** ([workflow](../../.github/workflows/migrate-production.yml)) against environment `production`
4. If migration fails, stop deployment and mark release as failed.
5. Run seed bootstrap for operator accounts:
   - `pnpm --filter @stay-ops/db seed`
6. Verify health endpoints:
   - `GET /api/health/live` -> `200`
   - `GET /api/health/ready` -> `200`
7. Verify sync behavior:
   - login-triggered sync is debounced
   - manual trigger works for authorized role
   - overlap returns `409` + `sync already running`
8. Verify cron behavior:
   - hourly schedule is active in daytime window only
   - cron endpoint auth/secret guard is enforced

## Daytime hourly cron policy

- Cron cadence: hourly.
- Schedule window: local daytime only (derived from `APP_TIMEZONE` and operator policy).
- Endpoint must remain protected via secret/header contract.
- Cron, login, and manual trigger flows all use the same DB lock rule.
- Required evidence: at least one daytime cron-triggered run captured in logs/audit.

## Pre-ship verification evidence (S8-aligned)

Collect these artifacts for release notes:
- CI status: [../../.github/workflows/ci.yml](../../.github/workflows/ci.yml) green.
- E2E status: [../../.github/workflows/e2e.yml](../../.github/workflows/e2e.yml) green.
- Health evidence: `/api/health/live` and `/api/health/ready` checks with timestamp.
- Auth evidence: successful admin + father logins.
- Sync evidence: one successful run and one overlap `409` run.
- Hosthub evidence: one success trace and one controlled failure trace.
- Approval record: GO/NO-GO with date and initials from both approvers.

## Health and readiness

- Health confirms process + DB connectivity.
- Readiness confirms operators can authenticate, load calendar workflows, and run
  production-context sync with expected lock semantics.

## Automated post-deploy checks

- [../../.github/workflows/health-check.yml](../../.github/workflows/health-check.yml)
  validates `/api/health/ready` after deployment events.
- Manual re-check anytime: [../../.github/workflows/verify-production-readiness.yml](../../.github/workflows/verify-production-readiness.yml).
- Health routes remain allowlisted in
  [../../apps/web/src/middleware.ts](../../apps/web/src/middleware.ts).
- If deployment protection is enabled on Vercel, probes from GitHub Actions see **HTTP 401** before the request reaches the app unless you add **[Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)** in the Vercel project and paste the same value into a GitHub repository secret **`VERCEL_AUTOMATION_BYPASS_SECRET`** so the workflow can send the `x-vercel-protection-bypass` header when curling the deployment URL.

## Rollback and restore rehearsal

1. Roll back Vercel to previous known-good deployment.
2. If schema compatibility is a concern, follow [./migrations.md](./migrations.md).
3. Re-run health checks and sync smoke validation.
4. Rehearse DB restore using documented backup flow before ship-ready sign-off.

## Startup checks

- Missing required env vars are hard startup failures.
- Production runtime and migration context both point to intended Neon DB.
- Hosthub credentials are present when sync is enabled.
