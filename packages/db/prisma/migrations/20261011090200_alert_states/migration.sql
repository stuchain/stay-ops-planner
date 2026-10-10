-- P2-8 monitoring: remembers which sync-health alert is currently open (additive only).
CREATE TABLE "alert_states" (
    "key" TEXT NOT NULL,
    "detail" TEXT,
    "alerted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_states_pkey" PRIMARY KEY ("key")
);
