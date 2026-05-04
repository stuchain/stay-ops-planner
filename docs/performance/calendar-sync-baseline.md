# Calendar and sync query baseline (Epic 12)

This document inventories high-frequency reads, gives repeatable `EXPLAIN` steps, and holds **before / after** notes when index or caching work lands.

## Measurement environment

Record here when you capture plans:

- **Postgres version:** `SELECT version();`
- **Approximate row counts:** `SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE relname IN ('bookings','manual_blocks','import_errors','rooms');`
- **`APP_TIMEZONE`:** must match the app default used by [`GET /api/calendar/month`](../../apps/web/src/app/api/calendar/month/route.ts) (`process.env.APP_TIMEZONE` or `Etc/UTC`).

## Calendar month aggregate (`getCalendarMonthAggregate`)

Implementation: [`apps/web/src/modules/calendar/monthAggregate.ts`](../../apps/web/src/modules/calendar/monthAggregate.ts).

Per request, Prisma runs:

| Order | Model | Purpose |
|-------|--------|---------|
| 1 | `Room` | Active rooms for column headers + sort |
| 2 | `Booking` | Overlap with zoned month window; `status` not `cancelled`; includes `assignment`, `sourceListing` |
| 3 | `ManualBlock` | Overlap with same window |
| 4 | `ImportError` | `resolved = false` and `createdAt` in `[monthStartUtc, monthEndExclusiveUtc)` |

Month bounds match [`zonedMonthRangeUtc`](../../apps/web/src/modules/calendar/monthBounds.ts) (IANA timezone → UTC instants).

### Representative booking overlap SQL

Prisma emits a predicate equivalent to:

```sql
WHERE b.checkin_date < :month_end_exclusive::date
  AND b.checkout_date > :month_start::date
  AND b.status <> 'cancelled'::"BookingStatus";
```

### Representative manual block overlap SQL

```sql
WHERE mb.start_date < :month_end_exclusive::date
  AND mb.end_date >= :month_start::date;
```

### Before: example `EXPLAIN (ANALYZE, BUFFERS)` snippet

Run the helper script (fills date literals from `APP_TIMEZONE`):

```bash
node ./packages/db/scripts/explain-calendar-baseline.mjs 2026-03 Etc/UTC
```

Copy the printed `explainBookings` / `explainManualBlocks` strings into `psql` against your database. Paste a redacted plan here, for example:

```
Seq Scan on bookings b  (cost=0.00..… rows=… width=…) (actual time=… rows=… loops=1)
  Filter: ((checkin_date < …) AND (checkout_date > …) AND (status <> 'cancelled'::"BookingStatus"))
  Buffers: shared read=…
Planning Time: … ms
Execution Time: … ms
```

_(Replace with your real plan after running.)_

### After indexes (Epic 12 migration)

Epic 12 adds:

- `manual_blocks_room_id_start_date_end_date_idx` on `(room_id, start_date, end_date)` — overlap + room-scoped maintenance.
- `bookings_calendar_active_checkin_checkout_idx` — partial btree on `(checkin_date, checkout_date)` **where** `status <> 'cancelled'` — calendar hot path.

Re-run the same `EXPLAIN` commands and summarize qualitatively (e.g. “Seq Scan → Bitmap Index Scan + heap fetch”).

## Sync-related reads

### `GET /api/sync/runs`

[`apps/web/src/app/api/sync/runs/route.ts`](../../apps/web/src/app/api/sync/runs/route.ts): `syncRun.findMany`, `orderBy: startedAt desc`, `take: 30`, narrow `select`. Low cardinality; document if `sync_runs` grows large (add index on `(started_at DESC)` only if profiling shows sort cost).

### Admin diagnostics (`GET /api/admin/sync/hosthub/diag`)

[`apps/web/src/app/api/admin/sync/hosthub/diag/route.ts`](../../apps/web/src/app/api/admin/sync/hosthub/diag/route.ts): parallel `count` / `groupBy` / `findMany` on bookings, listings, import errors. Treat as **admin-only hot path**; baseline with `EXPLAIN` on the heaviest `booking.count` / `groupBy` if operators report slowness.

## Caching note

Calendar month responses may be cached in **Redis** (module `@stay-ops/shared/calendar-month-cache`, key prefix `cal:month:v1:`) when `REDIS_URL` is set. Baseline latency should be measured **with cache cold** (delete `cal:month:v1:*` keys) vs **warm** for fair before/after index comparisons.

## Changelog

| Date | Change |
|------|--------|
| 2026-05-04 | Initial baseline doc + explain helper script |
| 2026-05-04 | Prisma migration `20260504103000_epic12_calendar_indexes`: `manual_blocks_room_id_start_date_end_date_idx`, `bookings_calendar_active_checkin_checkout_idx` |
