-- One-time cleanup: bookings that differ only by casing in external_booking_id (same channel).
-- Run after deploying Hosthub id normalization. Review the preview SELECT first; run in a transaction.
--
-- Keeps the oldest row by created_at per (channel, lower(trim(external_booking_id))).
-- If a duplicate row had an assignment and the survivor did not, re-points that assignment to the survivor.
-- Does not delete a duplicate row that still has an assignment when the survivor also has one (manual merge).
-- After removing duplicate rows, sets survivor external_booking_id to lower(trim(...)).
--
-- Order matters: DELETE losers before lowercasing the survivor, or UPDATE survivor can hit
-- UNIQUE(channel, external_booking_id) against the still-present loser row.
--
-- If both rows in a pair still have assignments, DELETE skips that loser and the survivor
-- UPDATE is skipped (no collision). Resolve those manually: pick the booking to keep, delete
-- the other booking (cascade drops its assignment), then lowercase the survivor's id.

BEGIN;

CREATE TEMP TABLE _dedupe_case_variant_pair (
  survivor_id text NOT NULL,
  loser_id text NOT NULL
) ON COMMIT DROP;

INSERT INTO _dedupe_case_variant_pair (survivor_id, loser_id)
WITH dup_groups AS (
  SELECT
    channel,
    lower(trim(external_booking_id::text)) AS ext_key,
    (array_agg(id ORDER BY created_at ASC))[1] AS survivor_id,
    array_agg(id ORDER BY created_at ASC) AS all_ids
  FROM bookings
  GROUP BY channel, lower(trim(external_booking_id::text))
  HAVING count(*) > 1
)
SELECT
  d.survivor_id,
  u.loser_id
FROM dup_groups d
CROSS JOIN LATERAL unnest(d.all_ids[2 : array_length(d.all_ids, 1)]) AS u(loser_id)
WHERE array_length(d.all_ids, 1) > 1;

-- Preview: SELECT * FROM _dedupe_case_variant_pair;

UPDATE assignments a
SET booking_id = p.survivor_id
FROM _dedupe_case_variant_pair p
WHERE a.booking_id = p.loser_id
  AND NOT EXISTS (SELECT 1 FROM assignments a2 WHERE a2.booking_id = p.survivor_id);

DELETE FROM bookings b
USING _dedupe_case_variant_pair p
LEFT JOIN assignments a ON a.booking_id = p.loser_id
WHERE b.id = p.loser_id
  AND a.id IS NULL;

-- Lowercase survivor only when no other row still shares the same channel + case-insensitive id
-- (if the loser was not deleted, e.g. both had assignments, skip — resolve that pair manually).
UPDATE bookings b
SET external_booking_id = lower(trim(external_booking_id::text))
FROM _dedupe_case_variant_pair p
WHERE b.id = p.survivor_id
  AND NOT EXISTS (
    SELECT 1
    FROM bookings o
    WHERE o.channel = b.channel
      AND o.id <> b.id
      AND lower(trim(o.external_booking_id::text)) = lower(trim(b.external_booking_id::text))
  );

COMMIT;
