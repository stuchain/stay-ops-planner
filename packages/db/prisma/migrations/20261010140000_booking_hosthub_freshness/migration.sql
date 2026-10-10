-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "hosthub_status" "BookingStatus",
ADD COLUMN     "hosthub_updated_at" TIMESTAMPTZ(6);

