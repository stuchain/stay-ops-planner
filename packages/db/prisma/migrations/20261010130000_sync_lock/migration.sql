-- CreateTable
CREATE TABLE "sync_lock" (
    "name" TEXT NOT NULL,
    "locked_until" TIMESTAMPTZ(6) NOT NULL,
    "holder" TEXT,

    CONSTRAINT "sync_lock_pkey" PRIMARY KEY ("name")
);

