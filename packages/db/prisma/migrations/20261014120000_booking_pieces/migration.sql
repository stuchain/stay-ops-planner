-- A booking can sit in more than one apartment when the guest moves mid-stay: one assignment row per piece.
DROP INDEX "assignments_booking_id_key";
CREATE INDEX "assignments_booking_id_start_date_idx" ON "assignments"("booking_id", "start_date");
-- Two pieces of the same booking can never overlap (pieces in the same apartment already can't, by room).
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_booking_piece_excl"
  EXCLUDE USING gist ("booking_id" WITH =, daterange("start_date", "end_date", '[)') WITH &&);
