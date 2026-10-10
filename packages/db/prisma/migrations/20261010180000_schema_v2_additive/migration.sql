-- Schema v2, part 1 (P1B-3): additive changes only, safe on existing data.
-- Part 2 (hosthub_event_id key, de-duplication, check constraints, dropped tables)
-- follows after a dry run on a copy of production.

-- Users: per-user feature flags (newUi), Dev mode and text size. New users default to Greek.
ALTER TABLE "users"
  ADD COLUMN "flags" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "dev_mode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "text_size" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "users" ALTER COLUMN "ui_locale" SET DEFAULT 'el';

-- Rooms: large-party preference and a fixed colour. max_guests is the capacity (adults + children).
ALTER TABLE "rooms"
  ADD COLUMN "preferred_for_large_party" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "color" TEXT;

-- Values agreed with Stelios (Phase 1A): Onar 3, Cosmos 4, Iris 3, Helios 4;
-- Cosmos and Helios suit parties of 3 or 4. Only fills values nobody has set.
UPDATE "rooms" r SET
  "max_guests" = COALESCE(r."max_guests", v.capacity),
  "preferred_for_large_party" = v.large,
  "color" = COALESCE(r."color", v.color)
FROM (VALUES
  ('onar', 3, false, '#0F766E'),
  ('cosmos', 4, true, '#4338CA'),
  ('iris', 3, false, '#BE185D'),
  ('helios', 4, true, '#A65F00')
) AS v(name, capacity, large, color)
WHERE lower(trim(COALESCE(r."display_name", r."code", ''))) = v.name
   OR lower(trim(COALESCE(r."code", ''))) = v.name;

-- Assignments: a manual placement the auto-planner must not change.
ALTER TABLE "assignments" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;

-- Sync state: one row holding the Hosthub cursor, replacing the cursor kept on sync_runs.
CREATE TABLE "sync_state" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "cursor" TEXT,
  "last_success_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sync_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sync_state_single_row" CHECK ("id" = 1)
);

INSERT INTO "sync_state" ("id", "cursor")
SELECT 1, (SELECT "cursor" FROM "sync_runs" WHERE "cursor" IS NOT NULL ORDER BY "started_at" DESC LIMIT 1)
ON CONFLICT ("id") DO NOTHING;
