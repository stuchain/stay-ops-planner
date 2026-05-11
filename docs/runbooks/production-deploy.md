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
  (**Dashboard** install/build overrides `vercel.json` if filled in.)
  **`buildCommand` runs migrations before the Next build:** `pnpm --filter @stay-ops/db exec prisma migrate deploy`, then **`prisma migrate status`**, then **`pnpm build:web`**. If either migrate step exits non‑zero, Vercel **does not ship** that deployment (EPICS Ship‑Epic **S3**).
  **`DATABASE_URL` must be available during the build** for every Vercel environment that runs this command (typically **Production** and **Preview**) — enable the same secret for **Build** (and Preview if applicable), not **Runtime-only**, otherwise migrate fails at build time. Use a **different** `DATABASE_URL` per environment when Preview should not touch production Neon (see [Preview deployments](#preview-deployments-and-the-production-database)).
  The web build builds `@stay-ops/web` and its workspace dependencies only (skips `packages/worker`) and uses pnpm **append-only** output so logs advance while `next build` compiles.
  [`apps/web/vercel.json`](../../apps/web/vercel.json) sets **`SKIP_STAYOPS_ENV_VALIDATE=1` for the build step only** so `next build` does not run strict `parseEnv` (which would **`exit(1)`** when session and other secrets exist only at **runtime**, not Build, in Vercel). Production serverless runtime still receives full env from the dashboard; **`DATABASE_URL` is an exception**: it must be present at **Build** too so `migrate deploy` can run (duplicate scope in Vercel UI).
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

**Primary path (S3):** migrations run inside the Vercel **`buildCommand`** (see [Locked deployment decisions](#locked-deployment-decisions)). The workflow below is **optional** — use it for break-glass runs, pre-deploy verification from a trusted machine, or when you need to migrate **before** merging app code that depends on the new schema.

For EPICS [S2 / S3](../EPICS_2.md) traceability you can apply pending migrations without pasting Neon credentials into CI logs explicitly beyond GitHub-supplied masking:

1. In GitHub: **Settings → Environments → create `production`** (recommended: required reviewers).
2. Add an environment secret **`DATABASE_URL`** on **`production`** with your Neon pooled connection string (same DB Vercel Production uses — see [below](#preview-deployments-and-the-production-database) if Preview shares it too).
3. Actions → **[Migrate production DB](../../.github/workflows/migrate-production.yml)** → **Run workflow** (manual `workflow_dispatch` only).

Steps run `prisma migrate deploy` then **`prisma migrate status`** ([workflow source](../../.github/workflows/migrate-production.yml)). Uses concurrency group `migrate-production` so overlapping dispatch runs do not cancel each other mid-flight.

**Ad-hoc readiness check:** Actions → **[Verify production readiness](../../.github/workflows/verify-production-readiness.yml)** — paste the **full** `https://…/api/health/ready` URL. Set repository secret **`VERCEL_AUTOMATION_BYPASS_SECRET`** if Deployment Protection otherwise returns HTTP 401 (same bypass as [.github/workflows/health-check.yml](../../.github/workflows/health-check.yml)).

You can still run `pnpm --filter @stay-ops/db migrate:deploy` from a trusted machine with Production `DATABASE_URL` instead.

## Preview deployments and the production database

**Every Preview and Production build** runs **`prisma migrate deploy`** against the **`DATABASE_URL` configured for that Vercel environment** (Production vs Preview keys in the dashboard). Wrong scoping risks migrating production from a branch preview or migrating a disposable DB unintentionally:

- Prefer a **separate Neon branch / DB** for Vercel **Preview** (`DATABASE_URL` on the Preview scope only) vs **Production** — same split-brain rules as EPICS **S2** (runtime and migration targets must match **per environment**).
- Some teams still point **both** Production and Preview at the **same** Neon URL (minimal household setup). Treat that DB as **the** production plane: every preview **build** applies pending migrations to it as well — do **not** merge migration PRs casually without coordination.
- Do **not** run destructive fixtures, **`seed:dev`**, **`migrate:dev`**, or experimental SQL against production-class URLs from ad-hoc jobs.
- Schema changes remain **`migrate deploy`** only ([migrations.md](migrations.md)). Vercel build is the default single path; GitHub **Migrate production DB** remains a coordinated alternative when needed.

## Operator-only steps (cannot be done from this repository)

These require your accounts, secrets, and browser—there is nothing to “push” for them:

| Step | You do |
|------|--------|
| Neon | Create DB; copy **`DATABASE_URL`**; keep it secret. |
| Vercel | Create/link project → Git repo → Root Directory **`apps/web`** → deploy. **`vercel.json`** supplies install/build commands. |
| Vercel env | Add **`DATABASE_URL`** for **Build + Runtime** (migrate runs at build), **`SESSION_SECRET`** (≥32 chars), **`APP_TIMEZONE`**, plus Hosthub/Sentry when needed (see [.env.example](../../.env.example)). |
| Vercel Git | Confirm **Production Branch** = **`main`**. |
| Schema + users | On a trusted machine, with **`DATABASE_URL`** set to **Neon**: `pnpm --filter @stay-ops/db migrate:deploy` then `pnpm --filter @stay-ops/db seed` (set **`BOOTSTRAP_ADMIN_*`** for seed). Never commit secrets. |

## Deploy order (production)

1. Confirm all required env vars are present in Vercel project settings (**`DATABASE_URL` enabled for Build + Runtime** on Production).
2. Trigger production deploy from `main` (auto or manual). The Vercel **build** runs **`migrate deploy` → `migrate status` → `next build`**; if migrate fails, the deployment **does not complete**.
3. Optional break-glass: run **`pnpm --filter @stay-ops/db migrate:deploy`** locally or GitHub Actions **Migrate production DB** ([workflow](../../.github/workflows/migrate-production.yml)) when you need to migrate **before** shipping dependent app code.
4. Run seed bootstrap for operator accounts (when identity is not yet provisioned):
   - `pnpm --filter @stay-ops/db seed`
5. Verify health endpoints:
   - `GET /api/health/live` -> `200`
   - `GET /api/health/ready` -> `200`
6. Verify sync behavior:
   - login-triggered sync is debounced
   - manual trigger works for authorized role
   - overlap returns `409` + `sync already running`
7. Verify cron behavior:
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

### Vercel “Build Failed (out of memory)”

**Cleaning up old deployments does not reduce build RAM** — each Production build starts on fresh hardware. OOM means the **`next build` Node process** (compile, NFT trace, workers) exhausted heap or container memory during that single run.

Standard Vercel builders have a **fixed RAM budget** (~8 GB including all processes). Large Next.js apps with **output file tracing** (and monorepo Prisma binaries) often spike during **“Collecting build traces”**. Giving Node a **heap limit near the full machine size** (`--max-old-space-size=8192`) often **triggers OS-level OOM**: the heap competes with Webpack/trace workers.

The web package pins a safer default in [`../../apps/web/package.json`](../../apps/web/package.json) (`NODE_OPTIONS=--max-old-space-size=6144` for `next build`). Locally, if traces still exhaust memory, run once with `cross-env NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @stay-ops/web run build` **on a larger machine**.

The app also applies Next.js-focused mitigations in [`../../apps/web/next.config.ts`](../../apps/web/next.config.ts) (aligned with [Next.js memory guidance](https://nextjs.org/docs/app/guides/memory-usage)):

- **`experimental.webpackMemoryOptimizations`** — lowers peak Webpack RSS (slightly slower compile).
- **`eslint.ignoreDuringBuilds`** — CI already runs **`pnpm lint`** ([`../../.github/workflows/ci.yml`](../../.github/workflows/ci.yml)); avoid duplicating ESLint inside **`next build`**.
- **`typescript.ignoreBuildErrors`** — CI runs **`pnpm -r run typecheck`** — same trade-off: fewer duplicate checks during **`next build`**. Merge only when typecheck stays green.
- **`productionBrowserSourceMaps: false`** and **`experimental.serverSourceMaps: false`** — less map work during the build.
- **`outputFileTracingExcludes`** for paths not used by the server bundle (worker package, docs, `.github`, `apps/web/tests`, `scripts`).
- **Narrow `outputFileTracingIncludes` for Prisma** — avoids a recursive `.pnpm` prisma glob that explodes NFT over the whole store.

If builds remain unstable after the above, enable Vercel **Enhanced Builds** (larger machines) from the dashboard, or tighten tracing further knowing it can drop required Prisma engine files — validate **`GET /api/health/ready`** after any tracing change.

For hotspots, **`next build --experimental-debug-memory-usage`** (see Next docs above) prints heap-centric diagnostics locally or in a throwaway CI job.

## Rollback and restore rehearsal

1. Roll back Vercel to previous known-good deployment.
2. If schema compatibility is a concern, follow [./migrations.md](./migrations.md).
3. Re-run health checks and sync smoke validation.
4. Rehearse DB restore using documented backup flow before ship-ready sign-off.

## Startup checks

- Missing required env vars are hard startup failures.
- Production runtime and migration context both point to intended Neon DB.
- Hosthub credentials are present when sync is enabled.
