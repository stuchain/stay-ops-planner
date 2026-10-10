-- Money page (Phase 3), additive only. The old excel_ledger_entries table stays until the
-- new page replaces the old one; scripts/migrate-ledger-entries copies it across in cents.

-- Bookings: Hosthub's total_value (what the guest pays, cleaning included), the money page's
-- gross amount. total_amount_cents holds booking_value (accommodation only), which is lower.
ALTER TABLE "bookings" ADD COLUMN "total_value_cents" INTEGER;

UPDATE "bookings" b SET "total_value_cents" = v.cents
FROM (
  SELECT id,
    CASE
      WHEN jsonb_typeof(tv) = 'object' AND tv->>'cents' ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN round((tv->>'cents')::numeric)
      WHEN jsonb_typeof(tv) = 'object' AND COALESCE(tv->>'amount', tv->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN round(COALESCE(tv->>'amount', tv->>'value')::numeric * 100)
      WHEN jsonb_typeof(tv) = 'number'
        THEN round((tv #>> '{}')::numeric * 100)
      WHEN jsonb_typeof(tv) = 'string' AND trim(tv #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN round(trim(tv #>> '{}')::numeric * 100)
    END::integer AS cents
  FROM (SELECT id, ("raw_payload"::jsonb)->'total_value' AS tv FROM "bookings" WHERE "raw_payload" IS NOT NULL) raw
) v
WHERE b.id = v.id AND v.cents IS NOT NULL;

-- Rooms: which money-page column (1-4) each apartment stands for, filled by name.
ALTER TABLE "rooms" ADD COLUMN "rental_index" INTEGER;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_rental_index_range" CHECK ("rental_index" BETWEEN 1 AND 4);

UPDATE "rooms" r SET "rental_index" = v.idx
FROM (VALUES ('onar', 1), ('cosmos', 2), ('iris', 3), ('helios', 4)) AS v(name, idx)
WHERE r."rental_index" IS NULL
  AND (lower(trim(COALESCE(r."display_name", r."code", ''))) = v.name
    OR lower(trim(COALESCE(r."code", ''))) = v.name);

-- Ledger corrections and manual rows, in cents, keyed by booking (E3-7).
CREATE TABLE "ledger_entries" (
  "id" TEXT NOT NULL,
  "booking_id" TEXT,
  "year" INTEGER,
  "month" INTEGER,
  "label" TEXT,
  "overrides" JSONB NOT NULL DEFAULT '{}',
  "hosthub_snapshot" JSONB,
  "legacy_entry_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_entries_manual_has_month" CHECK (
    "booking_id" IS NOT NULL OR ("year" IS NOT NULL AND "month" BETWEEN 1 AND 12)
  )
);

CREATE UNIQUE INDEX "ledger_entries_booking_id_key" ON "ledger_entries"("booking_id");
CREATE UNIQUE INDEX "ledger_entries_legacy_entry_id_key" ON "ledger_entries"("legacy_entry_id");
CREATE INDEX "ledger_entries_year_idx" ON "ledger_entries"("year");

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tax brackets per year. Seeded with the brackets the current spreadsheet implies
-- (15% to 12,000 EUR, 35% to 35,000 EUR, 45% above), unconfirmed until the accountant checks them.
CREATE TABLE "tax_rules" (
  "year" INTEGER NOT NULL,
  "brackets" JSONB NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'total',
  "income_basis" TEXT NOT NULL DEFAULT 'gross',
  "confirmed" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("year"),
  CONSTRAINT "tax_rules_scope_check" CHECK ("scope" IN ('total', 'per_apartment')),
  CONSTRAINT "tax_rules_income_basis_check" CHECK ("income_basis" IN ('gross', 'payout'))
);

INSERT INTO "tax_rules" ("year", "brackets", "note", "updated_at")
SELECT y, '[{"upToCents":1200000,"rateBps":1500},{"upToCents":3500000,"rateBps":3500},{"upToCents":null,"rateBps":4500}]'::jsonb,
  'From the spreadsheet; to be confirmed with the accountant', CURRENT_TIMESTAMP
FROM (VALUES (2025), (2026)) AS years(y)
ON CONFLICT ("year") DO NOTHING;
