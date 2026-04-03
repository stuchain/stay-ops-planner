-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('pending', 'confirmed', 'cancelled', 'needs_reassignment');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('airbnb', 'booking', 'direct');

-- AlterTable
ALTER TABLE "source_listings" ALTER COLUMN "channel" SET DATA TYPE "Channel" USING ("channel"::"Channel");

-- AlterTable
ALTER TABLE "bookings" ALTER COLUMN "channel" SET DATA TYPE "Channel" USING ("channel"::"Channel");
ALTER TABLE "bookings" ALTER COLUMN "status" SET DATA TYPE "BookingStatus" USING ("status"::"BookingStatus");
