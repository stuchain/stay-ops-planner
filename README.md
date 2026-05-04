# Stay Ops Planner

**Work in progress.** Internal tool for short-term rental ops: sync bookings from a channel manager, assign each stay to a **physical unit**, avoid double-booking, and coordinate cleaning and maintenance. Not for guests.

Stack direction: Next.js, PostgreSQL / Prisma, Redis for jobs — see [docs/architecture/CONVENTIONS.md](docs/architecture/CONVENTIONS.md). 

**Code review:** use [docs/architecture/CONVENTIONS.md](docs/architecture/CONVENTIONS.md) as the checklist for module boundaries, API errors, and data access.

## Requirements

- Node 20+
- [pnpm](https://pnpm.io/) (version pinned in root `package.json` as `packageManager`)

## Scripts (from repo root)

| Script | Description |
|--------|-------------|
| `pnpm dev` | Builds workspace packages, then starts the Next.js app (`apps/web`) |
| `pnpm build` | Builds all workspace packages (`pnpm -r run build`) |
| `pnpm lint` | Runs ESLint in all packages (`pnpm -r run lint`) |
| `pnpm typecheck` | Generates the Prisma client, then runs `tsc --noEmit` across every workspace package |
| `pnpm test` | Runs tests in all packages (`pnpm -r run test`) |

## Workspace layout

- `apps/web` — Next.js (App Router) UI and route handlers
- `packages/db` — Prisma schema and data access
- `packages/shared` — Shared types, env validation (Zod), and helpers
- `packages/worker` — Background jobs (BullMQ) entrypoint
- `packages/sync` — Hosthub client, webhooks queue, booking ingest ([Hosthub API docs](https://www.hosthub.com/docs/api/), [docs/vendor/hosthub-api.md](docs/vendor/hosthub-api.md))

## Current Repo Status

### Runtime/tooling baseline
- Next.js App Router app (`apps/web`)
- TypeScript path alias in the web app: `@/*` → `apps/web/src/*` (see `apps/web/tsconfig.json`)
- Environment validation in `packages/shared/src/env.ts`
- Prisma schema/migrations + seed harness in `packages/db/prisma/*`
- Local data stack via `docker-compose.yml` (Postgres + Redis)

### Authentication and internal access control
- Auth endpoints
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
- Session/cookie behavior
  - Cookie name: `stay_ops_session`
  - TTL: 24 hours
  - Signed/verified with `SESSION_SECRET`
  - Cookie attributes: `httpOnly`, `SameSite=lax`, `secure` in production
- Route protection
  - `apps/web/src/middleware.ts` denies by default and allows an explicit public allowlist
  - API unauthorized responses return JSON with `error.code = "UNAUTHORIZED"`
  - App routes redirect unauthenticated users to `/login?next=...`
  - Corrupt/expired cookies are cleared
- Persistence/bootstrap
  - `packages/db/prisma/schema.prisma` includes a `User` model mapped to the `users` table
  - `packages/db/prisma/seed.ts` supports idempotent admin upsert via `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`
- Recovery documentation: `docs/runbooks/auth-recovery.md`

### Allocation (room assignment)
- **API** (admin session required)
  - `POST /api/assignments` — assign an unassigned booking to a room
  - `PATCH /api/assignments/[id]/reassign` — move an assignment to another room
  - `POST /api/assignments/[id]/unassign` — return a booking to the unassigned queue
  - `GET /api/bookings/unassigned` — list bookings not yet assigned to a room (optional `meta.total`)
- **Domain logic** lives under `apps/web/src/modules/allocation/` (service + error types). Database overlap and uniqueness are enforced in Postgres; concurrent writes map to stable API errors such as `CONFLICT_ASSIGNMENT` and `BOOKING_ALREADY_ASSIGNED`.
- **Inactive rooms**: `Room.isActive` is honored; assigning or reassigning to an inactive room returns `ROOM_INACTIVE` (see [docs/phases/phase-04-allocation.md](docs/phases/phase-04-allocation.md)).

### Manual blocks
- **API** (admin session required)
  - `POST /api/blocks` — create a manual block on a room for a date range
  - `PATCH /api/blocks/[id]` / `DELETE /api/blocks/[id]` — update or remove a block
- **Service**: `apps/web/src/modules/blocks/service.ts` (facade over shared calendar rules). Overlaps with assignments or other blocks surface as `CONFLICT_ASSIGNMENT` / `CONFLICT_BLOCK` as appropriate.

### Cleaning tasks
- **API** (admin session required)
  - `GET /api/cleaning/tasks` / `POST /api/cleaning/tasks` — list and create service cleaning tasks
  - `PATCH /api/cleaning/tasks/[id]/schedule` — adjust planned window (validates against booking turnover rules)
  - `PATCH /api/cleaning/tasks/[id]/status` — status transitions (`in_progress`, `done`)
- **Engine** modules under `apps/web/src/modules/cleaning/` (scheduling, state machine, turnover generation). Spec and invariants: [docs/phases/phase-05-cleaning-engine.md](docs/phases/phase-05-cleaning-engine.md).

### Sync (Hosthub)
- `POST /api/sync/hosthub/webhook` — ingest webhook events (signature/HMAC when configured)
- `GET /api/sync/runs` — list recent sync run records (authenticated)
- `GET /api/health` — deployment health probe (DB connectivity + process uptime)
- Client and pipeline: `packages/sync`; vendor notes: [docs/vendor/hosthub-api.md](docs/vendor/hosthub-api.md), phase outline [docs/phases/phase-03-hosthub-sync.md](docs/phases/phase-03-hosthub-sync.md).

### API errors (conventions)
- JSON error shape: `{ error: { code, message, details? } }` (see [docs/architecture/CONVENTIONS.md](docs/architecture/CONVENTIONS.md)).
- Route handlers compose `jsonError` / module-specific envelopes so auth, validation, and domain codes stay consistent.

### Tests
- **Unit / package tests**: `packages/shared`, `packages/sync` (Vitest).
- **Web integration tests**: `apps/web/tests/integration/` (Vitest; `apps/web/vitest.config.ts` uses projects for integration + jsdom unit tests). They hit real Postgres and Redis — start `docker compose` before `pnpm --filter @stay-ops/web test`.
- **Web component tests (Phase 6 UI)**: `apps/web/tests/unit/` (Vitest + Testing Library + jsdom) — calendar cards/lanes/grid, block modal, unassigned drawer, cleaning board. Run with `pnpm --filter @stay-ops/web run test:unit` (no DB required) or as part of `pnpm --filter @stay-ops/web test`.
- **Browser E2E (Playwright)**: `apps/web/tests/e2e/` — desktop Chromium and mobile viewport (390×844). **Easiest local run:** `pnpm e2e:local` (Docker Postgres/Redis → migrate → seed → `seed:e2e` → Playwright on **port 3005** so it does not clash with `pnpm dev` on 3000; same disposable test admin as CI). Otherwise install browsers once (`pnpm --filter @stay-ops/web test:e2e:install`), seed the DB, set `E2E_ADMIN_*` to match `BOOTSTRAP_ADMIN_*`, then `pnpm --filter @stay-ops/web test:e2e`. Skipping seed or env vars causes login **401**. CI: [`.github/workflows/e2e.yml`](.github/workflows/e2e.yml) runs **Vitest integration** (`stayops_test`) and **Playwright** (`stayops`) in parallel on every PR. To stress-check smokes locally: `pnpm --filter @stay-ops/web test:e2e -- --grep @smoke --repeat-each=5`. See [docs/runbooks/local-dev.md](docs/runbooks/local-dev.md).
- **Visual regression (opt-in)**: `pnpm --filter @stay-ops/web run test:e2e:visual` runs tagged `@visual` screenshot tests (desktop 1280×720). First-time or after UI changes, add `-- --update-snapshots` and commit the PNGs next to the spec (Playwright’s `*-snapshots/` folders under `apps/web/tests/e2e/visual/`). Default `test:e2e` does not run this project (`PLAYWRIGHT_VISUAL` is unset).
- **Storybook (UI primitives)**: `pnpm --filter @stay-ops/web run storybook` (dev) or `pnpm --filter @stay-ops/web run build-storybook` (static output in `apps/web/storybook-static`, gitignored).
- Coverage includes auth, allocation (including races and inactive rooms), blocks, cleaning flows, DB constraints, and sync webhook behavior.

### Production deployment reference
- Target stack: Vercel + Neon + Upstash.
- Deployment runbook: [docs/runbooks/production-deploy.md](docs/runbooks/production-deploy.md).
- Incident runbooks:
  - [docs/runbooks/runbook-sync-failure.md](docs/runbooks/runbook-sync-failure.md)
  - [docs/runbooks/runbook-conflict-resolution.md](docs/runbooks/runbook-conflict-resolution.md)
  - [docs/runbooks/runbook-db-restore.md](docs/runbooks/runbook-db-restore.md)
  - [docs/runbooks/runbook-deploy-rollback.md](docs/runbooks/runbook-deploy-rollback.md)

### How to verify
- Start local services: `docker compose up -d` (or `docker compose up --build` the first time)
- Copy env: `.env.example` → `.env` / `apps/web/.env.local` as needed (never commit secrets)
- Apply DB + bootstrap admin: `pnpm --filter @stay-ops/db migrate:deploy` then `pnpm --filter @stay-ops/db seed` (with `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` set). For Playwright, also run `pnpm --filter @stay-ops/db seed:e2e` and align `E2E_ADMIN_*` with the bootstrap user — or run **`pnpm e2e:local`** once Chromium is installed to do Docker + migrate + both seeds + E2E with CI-aligned defaults.
- Run the app: `pnpm --filter @stay-ops/web dev`
- Run the full check from repo root: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`

### CI/CD quality gates (Epic 11)
- Required-check workflows (push and PR): [`.github/workflows/ci.yml`](.github/workflows/ci.yml) (`lint`, `typecheck`, `unit`) and [`.github/workflows/e2e.yml`](.github/workflows/e2e.yml) (`schema-drift`, `integration`, `playwright`).
- Optional light ruleset (no PR, no push-blocking checks) in [`.github/rulesets/main.json`](.github/rulesets/main.json) — see [`.github/rulesets/README.md`](.github/rulesets/README.md) for import/update commands.
- Post-deploy health probe: [`.github/workflows/health-check.yml`](.github/workflows/health-check.yml) listens on `deployment_status: success` and pings `/api/health/ready` on the deployment URL, surfacing the result as the `post-deploy-health` commit status.

### Roadmap / deeper spec
- Phased execution and acceptance criteria: [docs/phases/README.md](docs/phases/README.md) and individual phase files (calendar UX, suggestions, production readiness, etc. are specified there even when not yet built in code).

## Security note

- Do not commit operational secrets (for example `.env`, `SESSION_SECRET`, provider tokens, or database URLs with credentials). Use `.env.example` and local environment injection instead.
