# Architecture and module conventions

Authoritative conventions for module boundaries, API errors, data access, and testing. Update this file as the codebase grows; PRs that change layering or error contracts should reference the relevant section here.

## System shape

- **Monolith:** Next.js (App Router) for UI and HTTP API; background workers (BullMQ) for sync and polling.
- **Data:** PostgreSQL + Prisma; Redis for queues.
- **Auth:** Session-based internal admin access.

## Directory intent (`apps/web`)

| Area | Responsibility |
|------|----------------|
| `src/modules/auth` | Password verification, session creation, route guards |
| `src/modules/bookings` | Booking queries, direct booking creation (UI-driven), status |
| `src/modules/sync` | Hosthub client, webhook handler, poll worker registration |
| `src/modules/allocation` | Assignment commands, conflict checks, revalidation |
| `src/modules/calendar` | Month aggregation for UI |
| `src/modules/cleaning` | Task generation, scheduling validation, status transitions |
| `src/modules/blocks` | Maintenance blocks CRUD |
| `src/modules/suggestions` | Rule-based ranking only |
| `src/modules/audit` | Append-only audit writes and queries |

**Rule:** domain invariants (overlap, blocks, cancellation side effects) live in **services** called by route handlers, not only in React components.

## Packages

- `packages/db`: Prisma schema, migrations, generated client, seed.
- `packages/shared`: Env schema (Zod), shared date helpers, DTO types used by API and workers.
- `packages/worker`: Background jobs (BullMQ) entrypoint; shared `parseEnv`, queue registration, and calls into module services (no HTTP).

## Data access boundaries

- **Prisma** is used only inside **repositories** or **services** within a module (or thin wrappers in `packages/db`). Do not import `PrismaClient` in React components, route files, or ad hoc scripts except migrations/seed.
- **DB writes** (create/update/delete) go through a service method that owns the transaction and invariants—not through UI actions or multiple scattered calls from handlers.
- **Reads** may go through query helpers or services; keep query construction out of presentation components.

## Route handlers (thin orchestrators)

- **No business logic in route handlers or Server Actions** beyond validation, auth checks, and mapping errors to HTTP. Rules such as overlap detection, cleaning eligibility, and sync idempotency live in **services** under `src/modules/<area>/services` (or equivalent).
- Handlers **orchestrate**: parse body/query with Zod → call **one** service entrypoint → return JSON or `NextResponse` using the normative error envelope below.

## API style

- REST, JSON, consistent error shape (`code`, `message`, optional `details`).
- Mutations require authentication; rate-limit auth and mutation routes.

## Testing

- **Unit:** pure functions and domain rules (overlap, suggestions scoring) with fast feedback.
- **Integration:** Prisma + HTTP route handlers or Server Actions against a test database.
- **E2E:** critical operator flows (assign stay, cleaning workflow, calendar) against a running app.

## HTTP status policy (summary)

| Situation | Status |
|-----------|--------|
| Malformed JSON / failed Zod parse on body | **400** + `VALIDATION_ERROR` |
| Missing or invalid session | **401** |
| Authenticated but not allowed | **403** |
| Entity missing | **404** |
| Business rule conflict (overlap, stale version) | **409** with domain `code` |
| Semantic validation (e.g. bad date range) | **422** when distinct from 400 |

## HTTP error envelope (normative)

All JSON API errors use:

```json
{
  "error": {
    "code": "SNAKE_CASE_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

- `code` is stable for clients and tests; `message` can be refined but `code` must not change without migration note.
- Prefer **409** for business conflicts (overlap, stale version), **422** for semantic validation, **400** for malformed JSON/body.

## Global error code registry (cross-phase)

| Code | Typical HTTP | Domain |
|------|--------------|--------|
| `VALIDATION_ERROR` | 400 | Zod / input |
| `UNAUTHORIZED` | 401 | auth |
| `FORBIDDEN` | 403 | policy |
| `NOT_FOUND` | 404 | entity |
| `CONFLICT_ASSIGNMENT` | 409 | allocation |
| `CONFLICT_BLOCK` | 409 | allocation vs maintenance |
| `STALE_VERSION` | 409 | optimistic lock |
| `HOSTHUB_AUTH_FAILED` | 502 / 500 | sync |

Add new codes only in this section or in a phase appendix, then reference from implementation.

## Route handler rules

1. Parse `Request` body with Zod; return `VALIDATION_ERROR` on failure.
2. Call **one** service method per route (no orchestration logic in handler beyond try/catch).
3. Map domain errors to HTTP status + `code` in a single `toHttpError(err)` helper.
4. Never catch and swallow: log and rethrow or return 500 with generic message.

## Service layer rules

- Own transactions: `prisma.$transaction` lives in services, not in React.
- Idempotency: sync and webhook paths must document idempotency keys.
- Side effects: cancellation, cleaning cancel, and audit should be ordered and documented in phase specs.

## Logging

- Structured logs: `level`, `message`, `requestId`, `userId` (if any), `durationMs`.
- Never log passwords, tokens, session secrets, or full webhook payloads in production (truncate or hash).

## Audit

- Use `src/modules/audit` for append-only records of operator- and system-relevant changes (assignments, cleaning status, sync outcomes).
- Include **who** (user id when present), **what** (entity + action), and a **correlation** or request id when the change came from an HTTP request or job run.

## Rate limiting (recommended defaults)

- `/api/auth/login`: per-IP limit (e.g. 20/min).
- Mutating `/api/*`: higher limit but authenticated (e.g. 300/min per user).

## Versioning

- API: no `/v1` prefix required for internal app; if public API added later, introduce `/api/v1/*`.
- Suggestion engine: bump `SUGGESTION_ENGINE_VERSION` when scoring rules change.

## PR review checklist (short)

- [ ] Domain rule in service, not component or route handler.
- [ ] No new Prisma usage in UI or route files outside a service/repository call.
- [ ] New error `code` documented in **Global error code registry** (or phase appendix).
- [ ] Tests for happy + failure path at the appropriate level (unit / integration / e2e).
- [ ] Migration reviewed if schema changed.
