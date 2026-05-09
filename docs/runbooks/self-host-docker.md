# Self-host with Docker Compose

Single-machine deployment: **Postgres**, **Redis**, **Next.js web**, and **BullMQ sync worker**. Suitable for a VPS or homelab. For managed hosting (Vercel + Neon + Upstash + separate worker process), see [production-deploy.md](./production-deploy.md).

## Prerequisites

- Docker with Compose v2
- Git
- A domain (optional) and TLS termination in front of port **3000** for production (Caddy, Traefik, nginx, or cloud load balancer).

## 1. Clone and configure env

```bash
git clone <your-fork-or-upstream-url> stay-ops-planner
cd stay-ops-planner
cp .env.example .env
```

Edit `.env` at the **repo root** (Next loads it via `next.config`). For Compose defaults matching [docker-compose.yml](../../docker-compose.yml), you can keep:

- `DATABASE_URL=postgresql://stayops:stayops@localhost:5432/stayops` when running **migrate/seed from the host** against the published Postgres port.
- Inside containers, Compose overrides `DATABASE_URL` to use hostname `postgres`.

**Required for the app process** (see [packages/shared/src/env.ts](../../packages/shared/src/env.ts)):

- `SESSION_SECRET` — at least 32 characters (change the placeholder in Compose for anything beyond local sandboxes).
- `APP_TIMEZONE` — e.g. `Europe/Athens` or `Etc/UTC`.

**Bootstrap admin** (needed once for `seed`):

- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD` (min length enforced by seed script)

**Production webhooks** (if you use Hosthub inbound webhooks):

- `WEBHOOK_SECRET` and Hosthub variables described in [.env.example](../../.env.example).

## 2. Start the stack

From the repo root:

```bash
docker compose up --build -d
```

Wait until `postgres` and `redis` are healthy, then `web` and `worker` start.

## 3. Apply migrations

Run Prisma **migrate deploy** inside the web container (includes Prisma CLI):

```bash
docker compose exec web pnpm --filter @stay-ops/db run migrate:deploy
```

## 4. Seed bootstrap admin

With `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` exported on the host **or** temporarily added under `web.environment` in `docker-compose.yml`:

```bash
docker compose exec -e BOOTSTRAP_ADMIN_EMAIL -e BOOTSTRAP_ADMIN_PASSWORD web pnpm --filter @stay-ops/db run seed
```

If the variables are only in your shell:

```bash
export BOOTSTRAP_ADMIN_EMAIL="you@example.com"
export BOOTSTRAP_ADMIN_PASSWORD="your-secure-password"
docker compose exec -e BOOTSTRAP_ADMIN_EMAIL -e BOOTSTRAP_ADMIN_PASSWORD web pnpm --filter @stay-ops/db run seed
```

Then rotate away any throwaway password and create additional users (e.g. operator for family) as needed.

## 5. TLS and HTTPS

The `web` service listens on **3000** inside the network. In production:

- Put a reverse proxy on the host with HTTPS and forward to `127.0.0.1:3000`, or
- Use a Dockerized reverse proxy on ports 80/443 with a volume for ACME certs.

Ensure `SESSION_COOKIE_SECURE` behavior matches your TLS setup (see [.env.example](../../.env.example)).

## 6. Smoke checks

- `curl -sS http://127.0.0.1:3000/api/health/live`
- `curl -sS http://127.0.0.1:3000/api/health/ready`
- Open `http://127.0.0.1:3000/login` (or your HTTPS URL) and sign in.

Confirm **`worker`** logs without continuous crash loops (`docker compose logs -f worker`). The worker requires `REDIS_URL` and uses the same `DATABASE_URL` / Hosthub-related env as the web app for sync jobs.

## 7. Hosthub webhooks (optional)

Point Hosthub at `https://<your-domain>/api/sync/hosthub/webhook` and set `WEBHOOK_SECRET` to match what Hosthub signs with. See [vendor/hosthub-api.md](../vendor/hosthub-api.md).

## 8. Backups and upgrades

- Postgres data lives in the `postgres_data` volume. Use your platform snapshots or the repo’s `pnpm backup:pg` / restore runbooks when running against a reachable `DATABASE_URL`.
- **Upgrades:** pull the image or rebuild (`docker compose build --pull`), run `migrate:deploy` again, restart `web` and `worker`.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Web exits on boot | `docker compose logs web` — often missing `SESSION_SECRET` or invalid `DATABASE_URL`. |
| Worker exits immediately | `docker compose logs worker` — requires `REDIS_URL`; must share DB/network with Postgres. |
| 401 on all API routes | Session cookie `Secure` vs HTTP; use HTTPS or adjust `SESSION_COOKIE_SECURE` for local HTTP only. |

For local development without full Docker app build, prefer [local-dev.md](./local-dev.md) (`docker compose up -d postgres redis` + `pnpm dev` on the host).
