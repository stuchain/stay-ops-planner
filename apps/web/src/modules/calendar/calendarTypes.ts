export type CalendarRoom = {
  id: string;
  code: string | null;
  name: string | null;
  isActive: boolean;
};

export type CalendarBookingItem = {
  kind: "booking";
  id: string;
  roomId: string | null;
  startDate: string;
  endDate: string;
  guestName: string;
  status: string;
  assignmentId: string | null;
  assignmentVersion: number | null;
  flags: string[];
};

export type CalendarBlockItem = {
  kind: "block";
  id: string;
  roomId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
};

export type CalendarMarker = {
  kind: string;
  bookingId: string | null;
  severity: string;
  message: string;
  code: string | null;
};

export type CalendarMonthPayload = {
  month: string;
  timezone: string;
  rooms: CalendarRoom[];
  items: (CalendarBookingItem | CalendarBlockItem)[];
  markers: CalendarMarker[];
};
