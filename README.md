# Stay Ops Planner

**Work in progress.** Internal tool for short-term rental ops: sync bookings from a channel manager, assign each stay to a **physical unit**, avoid double-booking, and coordinate cleaning and maintenance. Not for guests.

Stack direction: Next.js, PostgreSQL / Prisma, Redis for jobs — see [docs/architecture/CONVENTIONS.md](docs/architecture/CONVENTIONS.md). Execution spec: [docs/phases/README.md](docs/phases/README.md).

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
| `pnpm test` | Runs tests in all packages (`pnpm -r run test`) |

## Workspace layout

- `apps/web` — Next.js (App Router) UI and route handlers
- `packages/db` — Prisma schema and data access
- `packages/shared` — Shared types, env validation (Zod), and helpers
- `packages/worker` — Background jobs (BullMQ) entrypoint; stub for now

## Current Repo Status

### Runtime/tooling baseline
- Next.js App Router app
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

### How to verify
- Start local services: `docker compose up --build`
- Apply DB + bootstrap admin: `pnpm --filter @stay-ops/db migrate:deploy` then `pnpm --filter @stay-ops/db seed`
- Run the app: `pnpm --filter @stay-ops/web dev`
- Run integration tests: `pnpm --filter @stay-ops/web test` (see `apps/web/tests/integration/`)

## Security note

- Do not commit operational secrets (for example `.env`, `SESSION_SECRET`, provider tokens, or database URLs with credentials). Use `.env.example` and local environment injection instead.
