# ADR 0001: Architecture of the new foundation (Phase 1B)

Status: accepted, 2026-10-10. Plan: `foundation-review/phases/phase-1-design-and-foundation.md`, task P1B-1.

## Context

The app grew screen by screen: REST routes, services and UI live together under `apps/web/src/modules`, the calendar has several APIs, and the allocation rules are spread across the web app and `packages/sync`. A fresh clone did not typecheck because packages had to be built in a fixed order by hand. Phase 1B rebuilds the foundation under a new UI that ships behind a per-user flag, while the old screens keep working.

## Decisions

**Monorepo and tasks.** pnpm workspaces with Turborepo. `build`, `typecheck`, `lint` and `test` run with `turbo run <task>`; `typecheck`, `lint` and `test` depend on `^build`, so workspace packages are built first. `corepack pnpm install && corepack pnpm turbo typecheck lint test` works on a fresh clone with no database.

**Packages.**
- `packages/domain`: pure TypeScript (only zod). Stays as `YYYY-MM-DD` strings with half-open nights, allocation checks, the recommender and the planner, and the `DomainError` codes. 100% branch coverage, with fast-check properties.
- `packages/db`: Prisma schema and migrations.
- `packages/hosthub` (with the sync rewrite, P1B-7): the Hosthub client and normalisation. The sync use case moves into the web server layer.

**Layers in `apps/web/src`.** Enforced by `eslint-plugin-boundaries` in `apps/web/eslint.config.mjs`.

| Folder | Holds | May import |
|---|---|---|
| `ui/` | design tokens, `theme.css`, presentational components | `ui`, `i18n`, `@stay-ops/domain` |
| `features/<feature>/` | screens and their hooks | `ui`, `api`, `i18n`, other features, `@stay-ops/domain` |
| `api/` | tRPC client, query defaults, error text | types only from `server` |
| `server/` | use cases (`server/useCases`), tRPC routers (`server/api`), user preferences (`server/userPreferences.ts`) | `server`, old `modules`/`lib` while they are replaced, `@stay-ops/domain`, `@stay-ops/db` |
| `app/` | Next.js routes and layouts | anything |
| `modules/`, `lib/` | the old app | (unchanged; deleted as screens move) |

**API.** tRPC v11 over `/api/trpc` with TanStack Query on the client. Procedures: `publicProcedure`, `userProcedure`, `operatorProcedure` (can change bookings) and `adminProcedure`; roles are checked on the server and Dev mode never grants anything. Errors are `DomainError`s with a code and safe params; the client shows the translated text from `i18n/errors.el.ts` / `errors.en.ts` and never the server message. Query defaults: 30 s stale time, reads retry twice, writes never retry, refetch on focus. A middleware tags Sentry events with the procedure name.

**TypeScript.** `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` for the whole workspace, in `tsconfig.base.json`.

**Styling.** Tailwind v4 through `@tailwindcss/postcss`, with the theme in `ui/theme.css` built from `ui/tokens.ts` (a unit test keeps them in step). Tailwind's global reset is not loaded: the reset and colours apply inside `[data-ui="new"]` only, and utilities are generated only from `ui/`, `features/` and the Dev mode cleaning board. Radix primitives (Dialog), Sonner toasts and Lucide icons. Font: Commissioner, self-hosted through `@fontsource-variable/commissioner`.

**Feature flag (removed).** `users.flags` (JSON) held a per-user `newUi` flag during the migration. The old UI and the flag are gone (P2-10); the column stays in the database (additive-only rule) and is no longer read.

**Formatting.** Prettier for new code (`pnpm format`, `pnpm format:check`); the old code keeps its style until it is replaced.

## Consequences

- New code cannot reach into the old modules from the browser layers, so the old code can be deleted screen by screen (P1B-10).
- `tsconfig.base.json` is a Turborepo global dependency, so changing it re-runs every task.
