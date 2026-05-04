-- Epic 12: overlap-friendly index for manual blocks (calendar + stay conflict checks).
CREATE INDEX "manual_blocks_room_id_start_date_end_date_idx" ON "manual_blocks"("room_id", "start_date", "end_date");

-- Partial index: calendar month query excludes cancelled bookings (see getCalendarMonthAggregate).
CREATE INDEX "bookings_calendar_active_checkin_checkout_idx" ON "bookings"("checkin_date", "checkout_date") WHERE "status" <> 'cancelled'::"BookingStatus";
