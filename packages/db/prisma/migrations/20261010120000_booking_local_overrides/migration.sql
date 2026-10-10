-- Fields the user edited in the app; Hosthub sync skips them.
ALTER TABLE "bookings" ADD COLUMN "local_overrides" JSONB;
