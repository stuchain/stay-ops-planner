-- AlterTable
ALTER TABLE "sync_runs" ADD COLUMN     "stats_json" JSONB,
ADD COLUMN     "cursor" TEXT;
