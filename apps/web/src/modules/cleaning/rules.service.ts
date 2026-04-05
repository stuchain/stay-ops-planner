/**
 * Service cleaning (60 minutes) — explicit triggers:
 * - `POST /api/cleaning/tasks` with `taskType: service` (Phase 5.5)
 * - Phase 6 operator actions (schedule service clean)
 *
 * Dedupe: unique `sourceEventId` per operation (see `createServiceCleaningTask` in `@stay-ops/db`).
 */
