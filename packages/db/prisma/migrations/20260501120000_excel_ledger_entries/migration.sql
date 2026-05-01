-- CreateTable
CREATE TABLE "excel_ledger_entries" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "booking_id" TEXT,
    "manual_name" TEXT,
    "manual_month" INTEGER,
    "overrides" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "excel_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "excel_ledger_entries_year_idx" ON "excel_ledger_entries"("year");

-- CreateIndex
CREATE UNIQUE INDEX "excel_ledger_entries_year_booking_id_key" ON "excel_ledger_entries"("year", "booking_id");

-- AddForeignKey
ALTER TABLE "excel_ledger_entries" ADD CONSTRAINT "excel_ledger_entries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
