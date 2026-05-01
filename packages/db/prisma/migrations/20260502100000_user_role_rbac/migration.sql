-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('viewer', 'operator', 'admin');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'operator';
