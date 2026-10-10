-- Sign out everywhere (additive): a session whose version differs from this one is rejected.
ALTER TABLE "users" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
