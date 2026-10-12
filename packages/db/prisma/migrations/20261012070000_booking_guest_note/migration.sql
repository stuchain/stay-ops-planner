-- The team's own note about the guest of a booking, shown again when the same guest books another stay.
-- Sync never writes it.
ALTER TABLE "bookings" ADD COLUMN "guest_note" TEXT;
