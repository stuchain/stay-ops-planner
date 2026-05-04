-- CreateEnum
CREATE TYPE "UiLocale" AS ENUM ('en', 'el');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "ui_locale" "UiLocale" NOT NULL DEFAULT 'en';
