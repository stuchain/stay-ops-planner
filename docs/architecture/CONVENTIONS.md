# Architecture and module conventions

This document is the deliverable for the Phase 0 commit `docs: add architecture and coding conventions for service module boundaries`. Update it as the codebase grows.

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

## API style

- REST, JSON, consistent error shape (`code`, `message`, optional `details`).
- Mutations require authentication; rate-limit auth and mutation routes.

## Testing

- Unit tests for pure domain and conflict logic.
- Integration tests for DB + HTTP handlers.
- E2E for critical operator flows (assign, cleaning, calendar).

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

## Rate limiting (recommended defaults)

- `/api/auth/login`: per-IP limit (e.g. 20/min).
- Mutating `/api/*`: higher limit but authenticated (e.g. 300/min per user).

## Versioning

- API: no `/v1` prefix required for internal app; if public API added later, introduce `/api/v1/*`.
- Suggestion engine: bump `SUGGESTION_ENGINE_VERSION` when scoring rules change.

## PR review checklist (short)

- [ ] Domain rule in service, not component.
- [ ] New error code documented.
- [ ] Tests for happy + failure path.
- [ ] Migration reviewed if schema changed.
