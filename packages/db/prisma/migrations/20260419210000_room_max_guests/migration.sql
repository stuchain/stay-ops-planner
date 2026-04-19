-- Nullable: no limit when unset (backward compatible).
ALTER TABLE "rooms" ADD COLUMN "max_guests" INTEGER;
