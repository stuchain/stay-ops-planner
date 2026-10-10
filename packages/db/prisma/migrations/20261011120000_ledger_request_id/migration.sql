-- A manual ledger row remembers the id of the save that created it, so the same save sent again
-- (after an answer that never arrived) finds that row instead of adding a second one.
ALTER TABLE "ledger_entries" ADD COLUMN "request_id" TEXT;
CREATE UNIQUE INDEX "ledger_entries_request_id_key" ON "ledger_entries"("request_id");
