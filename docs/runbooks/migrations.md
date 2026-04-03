# Database migrations (Prisma)

All schema and migrations live in `packages/db/prisma/`. Run Prisma CLI from the repo root using the `@stay-ops/db` package filter.

## Command contract

| Command | When to use |
|---------|----------------|
| `pnpm --filter @stay-ops/db generate` | After dependency install or schema change; **always** before `pnpm -r build` in CI. |
| `pnpm --filter @stay-ops/db migrate:dev` | **Local only** — creates a new migration from schema edits and applies it to your dev database. |
| `pnpm --filter @stay-ops/db migrate:deploy` | **CI / production** — applies pending migrations only; never creates new migration files. |
| `pnpm --filter @stay-ops/db seed` | Local / test — runs `prisma/seed.ts` after migrations when you need bootstrap data. |

## Pipeline order (reference)

```text
pnpm install --frozen-lockfile
pnpm --filter @stay-ops/db generate
pnpm --filter @stay-ops/db migrate:deploy   # in deployed environments with DATABASE_URL
pnpm -r run build
pnpm --filter @stay-ops/web start           # or your process manager
```

`migrate:deploy` fails if there are pending migrations that do not apply cleanly — treat that as a release blocker.

## Local workflow

1. Copy `.env.example` to `.env.local` and set `DATABASE_URL` (e.g. Postgres from [local-dev.md](local-dev.md)).
2. Edit `packages/db/prisma/schema.prisma`.
3. Run `pnpm --filter @stay-ops/db migrate:dev --name describe_change`.
4. Commit the updated `schema.prisma` and new folder under `prisma/migrations/`.

Do **not** use `migrate:dev` in production or CI; use `migrate:deploy` only.

## Failure modes

| Symptom | Likely cause |
|---------|----------------|
| `migrate deploy` errors on startup | Drift between DB and migration history; restore from backup or fix migrations in a **new** migration (never rewrite applied history in prod without ops sign-off). |
| Build fails after pull | Run `pnpm --filter @stay-ops/db generate` so the generated client matches the schema. |
