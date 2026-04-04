import { BookingStatus } from "@stay-ops/db";
import type { HosthubReservationDto } from "../hosthub/types.dto.js";

export function mapHosthubBookingStatus(status: HosthubReservationDto["status"]): BookingStatus {
  switch (status) {
    case "cancelled":
      return BookingStatus.cancelled;
    case "pending":
      return BookingStatus.pending;
    default:
      return BookingStatus.confirmed;
  }
}
