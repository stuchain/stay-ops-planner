-- Epic 7: login brute-force tracking + generic rate-limit counters

CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_attempts_email_created_at_idx" ON "login_attempts"("email", "created_at");
CREATE INDEX "login_attempts_ip_created_at_idx" ON "login_attempts"("ip", "created_at");

CREATE TABLE "rate_limit_counters" (
    "scope" TEXT NOT NULL,
    "bucket_key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("scope","bucket_key","window_start")
);

CREATE INDEX "rate_limit_counters_window_start_idx" ON "rate_limit_counters"("window_start");
