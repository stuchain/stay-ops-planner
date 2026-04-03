-- Half-open stay intervals [checkin, checkout) using daterange '[)'.
-- Requires btree_gist for exclusion constraints on range types.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "assignments"
ADD CONSTRAINT "assignments_room_stay_excl"
EXCLUDE USING gist (
  "room_id" WITH =,
  daterange("start_date", "end_date", '[)') WITH &&
);

ALTER TABLE "manual_blocks"
ADD CONSTRAINT "manual_blocks_room_stay_excl"
EXCLUDE USING gist (
  "room_id" WITH =,
  daterange("start_date", "end_date", '[)') WITH &&
);
