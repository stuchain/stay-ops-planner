-- Per–Hosthub listing rental slot (1–4) for tax ledger; editable in admin.
ALTER TABLE "source_listings" ADD COLUMN "rental_index" INTEGER;

-- Singleton config for rental column header labels.
CREATE TABLE "excel_rental_config" (
    "id" INTEGER NOT NULL,
    "label1" TEXT NOT NULL DEFAULT 'Onar',
    "label2" TEXT NOT NULL DEFAULT 'Cosmos',
    "label3" TEXT NOT NULL DEFAULT 'Iris',
    "label4" TEXT NOT NULL DEFAULT 'Helios',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "excel_rental_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "excel_rental_config" ("id", "label1", "label2", "label3", "label4", "updated_at")
VALUES (1, 'Onar', 'Cosmos', 'Iris', 'Helios', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Backfill rental_index from listing title (same substring rules as legacy ledger).
UPDATE "source_listings" SET "rental_index" = 1 WHERE "rental_index" IS NULL AND lower(coalesce("title", '')) LIKE '%onar%';
UPDATE "source_listings" SET "rental_index" = 2 WHERE "rental_index" IS NULL AND lower(coalesce("title", '')) LIKE '%cosmos%';
UPDATE "source_listings" SET "rental_index" = 3 WHERE "rental_index" IS NULL AND lower(coalesce("title", '')) LIKE '%iris%';
UPDATE "source_listings" SET "rental_index" = 4 WHERE "rental_index" IS NULL AND lower(coalesce("title", '')) LIKE '%helios%';
