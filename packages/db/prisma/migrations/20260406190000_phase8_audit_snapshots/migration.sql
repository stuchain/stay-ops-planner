ALTER TABLE "audit_events"
ADD COLUMN "before_json" JSONB,
ADD COLUMN "after_json" JSONB,
ADD COLUMN "meta_json" JSONB;

CREATE INDEX "audit_events_entity_type_created_at_idx"
  ON "audit_events"("entity_type", "created_at");

CREATE INDEX "audit_events_entity_id_created_at_idx"
  ON "audit_events"("entity_id", "created_at");

CREATE INDEX "audit_events_user_id_created_at_idx"
  ON "audit_events"("user_id", "created_at");

-- Backfill prior payload rows into after_json for continuity.
UPDATE "audit_events"
SET "after_json" = "payload"
WHERE "after_json" IS NULL
  AND "payload" IS NOT NULL;
