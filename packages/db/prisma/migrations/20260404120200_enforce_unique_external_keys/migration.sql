-- CreateIndex
CREATE UNIQUE INDEX "source_listings_channel_external_listing_id_key" ON "source_listings"("channel", "external_listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_channel_external_booking_id_key" ON "bookings"("channel", "external_booking_id");
