-- Phase 5: cleaning task types, planned window, idempotency.
ALTER TABLE "cleaning_tasks" ADD COLUMN "task_type" TEXT NOT NULL DEFAULT 'turnover';
ALTER TABLE "cleaning_tasks" ADD COLUMN "source_event_id" TEXT;
ALTER TABLE "cleaning_tasks" ADD COLUMN "planned_start" TIMESTAMP(3);
ALTER TABLE "cleaning_tasks" ADD COLUMN "planned_end" TIMESTAMP(3);
ALTER TABLE "cleaning_tasks" ADD COLUMN "assignee_name" TEXT;
ALTER TABLE "cleaning_tasks" ADD COLUMN "duration_minutes" INTEGER;

UPDATE "cleaning_tasks" SET "status" = 'todo' WHERE "status" IS NULL;

ALTER TABLE "cleaning_tasks" ALTER COLUMN "status" SET DEFAULT 'todo';
ALTER TABLE "cleaning_tasks" ALTER COLUMN "status" SET NOT NULL;

CREATE UNIQUE INDEX "cleaning_tasks_source_event_id_key" ON "cleaning_tasks"("source_event_id");
CREATE UNIQUE INDEX "cleaning_tasks_one_turnover_per_booking" ON "cleaning_tasks"("booking_id") WHERE "task_type" = 'turnover';

CREATE INDEX "cleaning_tasks_booking_id_task_type_idx" ON "cleaning_tasks"("booking_id", "task_type");
