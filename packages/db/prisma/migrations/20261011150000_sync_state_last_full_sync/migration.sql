-- When the last sync that fetched every Hosthub event finished. A day later the next sync fetches everything again,
-- so a cancellation the incremental fetch missed still reaches the calendar.
ALTER TABLE "sync_state" ADD COLUMN "last_full_sync_at" TIMESTAMPTZ(6);
