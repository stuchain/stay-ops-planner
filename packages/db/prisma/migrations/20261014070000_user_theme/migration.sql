-- Theme setting per user: light (default), dark, or system.
ALTER TABLE "users" ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'light';
