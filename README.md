# Stay Ops Planner

**Work in progress.** Internal tool for short-term rental ops: sync bookings from a channel manager, assign each stay to a **physical unit**, avoid double-booking, and coordinate cleaning and maintenance. Not for guests.

Stack direction: Next.js, PostgreSQL / Prisma, Redis for jobs — see [docs/architecture/CONVENTIONS.md](docs/architecture/CONVENTIONS.md). **Phased implementation spec:** [docs/phases/README.md](docs/phases/README.md).

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
- `packages/db` — Prisma schema and data access (wired in later phases)
- `packages/shared` — Shared types, env validation, and helpers
