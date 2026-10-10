-- Hosthub's value for each column the user edited in the app, so the booking panel can show
-- "Από Hosthub: ..." and reset can bring it back. Additive only.
ALTER TABLE "bookings" ADD COLUMN "hosthub_values" JSONB;
