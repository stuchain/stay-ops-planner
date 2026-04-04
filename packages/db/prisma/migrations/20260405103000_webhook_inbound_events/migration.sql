-- CreateTable
CREATE TABLE "webhook_inbound_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "payload_hash" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_inbound_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_inbound_events_dedupe_key_key" ON "webhook_inbound_events"("dedupe_key");
