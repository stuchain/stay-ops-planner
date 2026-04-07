CREATE TYPE "AlertConfigChannel" AS ENUM ('whatsapp', 'sms');
CREATE TYPE "AlertConfigEventType" AS ENUM (
  'sync_run_failed',
  'unassigned_backlog_threshold_reached',
  'cleaning_overdue',
  'conflict_resolution_required'
);
CREATE TYPE "OperationalThresholdKey" AS ENUM (
  'unassigned_backlog_count',
  'unassigned_backlog_window_hours',
  'cleaning_overdue_minutes',
  'conflict_resolution_sla_minutes',
  'sync_failure_suppression_minutes'
);

CREATE TABLE "alert_template_configs" (
  "id" TEXT NOT NULL,
  "event_type" "AlertConfigEventType" NOT NULL,
  "channel" "AlertConfigChannel" NOT NULL,
  "template_version" INTEGER NOT NULL DEFAULT 1,
  "title" TEXT,
  "body" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "meta_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "alert_template_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "operational_threshold_configs" (
  "id" TEXT NOT NULL,
  "key_name" "OperationalThresholdKey" NOT NULL,
  "numeric_value" DECIMAL(12,3),
  "string_value" TEXT,
  "unit" TEXT,
  "notes" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "operational_threshold_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "alert_template_configs_event_channel_version_key"
  ON "alert_template_configs"("event_type", "channel", "template_version");
CREATE INDEX "alert_template_configs_event_channel_enabled_idx"
  ON "alert_template_configs"("event_type", "channel", "enabled");

CREATE UNIQUE INDEX "operational_threshold_configs_key_name_key"
  ON "operational_threshold_configs"("key_name");
CREATE INDEX "operational_threshold_configs_enabled_idx"
  ON "operational_threshold_configs"("enabled");
