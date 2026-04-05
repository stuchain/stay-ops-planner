# Local development

## Prerequisites

- Node 20+
- pnpm (see root `package.json` `packageManager` pin)
- Docker with Compose v2 (Docker Desktop or Engine + Compose plugin)

## Environment variables

Copy `.env.example` to `.env.local` before running the app or worker. Required keys are validated at startup (see `packages/shared/src/env.ts`): `DATABASE_URL`, `SESSION_SECRET` (32+ characters), and `APP_TIMEZONE`. Missing or invalid values fail the process with a JSON error listing fields.

## One-command stack (Postgres + Redis + web)

From the repository root:

```bash
docker compose up --build
```

This starts:

- **Postgres** on host port `5432` (user/password/db: `stayops` / `stayops` / `stayops`)
- **Redis** on host port `6379`
- **web** on host port `3000`, after Postgres and Redis report healthy

The `web` container receives `DATABASE_URL` and `REDIS_URL` pointing at the compose service hostnames (`postgres`, `redis`). For processes running on your **host** (e.g. `pnpm dev`), use `localhost` and the same ports — see `.env.example`.

## Host-only app (containers for data services only)

Useful for faster iteration on the Next app:

```bash
docker compose up -d postgres redis
cp .env.example .env.local
# Edit DATABASE_URL / REDIS_URL if your ports differ
pnpm dev
```

## Port conflicts

If `5432` or `6379` is already in use locally, change the **left** side of the port mapping in `docker-compose.yml`, for example:

```yaml
ports:
  - "5433:5432"
```

Then set `DATABASE_URL` to use `localhost:5433` (and the same credentials/db name as in compose).

## Reset local database data (destructive)

Removes the named volume and recreates an empty Postgres data directory:

```bash
docker compose down -v
docker compose up -d postgres redis
```

**Warning:** This deletes all data in the `postgres_data` volume. Do not use against shared or production databases.

## Playwright E2E (apps/web)

Requires Postgres/Redis and a staff user in the DB whose password matches what Playwright sends (`E2E_ADMIN_*`). If you run `pnpm --filter @stay-ops/web test:e2e` **without** seeding or **without** those env vars, login returns **401** and tests fail.

### One command (recommended)

From repo root, with Docker running:

```bash
pnpm e2e:local
```

This runs `docker compose up -d postgres redis`, waits for Postgres, `prisma migrate deploy`, `seed`, `seed:e2e`, then Playwright. Default `BOOTSTRAP_ADMIN_*` / `E2E_ADMIN_*` / `DATABASE_URL` match [`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml) (local disposable only). Override any of them in your environment if needed.

Install Chromium once first: `pnpm --filter @stay-ops/web test:e2e:install`

### Manual steps

1. Install Chromium once: `pnpm --filter @stay-ops/web test:e2e:install`
2. Start Postgres/Redis (`docker compose up -d postgres redis`) and migrate + seed + E2E fixtures:  
   `pnpm --filter @stay-ops/db exec prisma migrate deploy`  
   `pnpm --filter @stay-ops/db seed`  
   `pnpm --filter @stay-ops/db seed:e2e`
3. Export credentials for login specs (must match bootstrap admin from seed), for example:
   - `E2E_ADMIN_EMAIL`
   - `E2E_ADMIN_PASSWORD`
4. From repo root: `pnpm --filter @stay-ops/web test:e2e`  
   Playwright starts `next dev` on port 3000 by default. To use an already-running app: `PLAYWRIGHT_NO_SERVER=1` and `PLAYWRIGHT_BASE_URL=http://localhost:3000`.

GitHub Actions runs the same flow (migrate → seed → seed:e2e → Playwright) in `.github/workflows/e2e.yml`.

## Troubleshooting

- **`docker compose config`** — validate YAML and merged settings.
- **`docker compose ps`** — service status.
- **`docker compose logs -f postgres`** / **`redis`** — service logs.
