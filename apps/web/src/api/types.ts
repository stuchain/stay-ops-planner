import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/api/root";

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export type CalendarRangeData = RouterOutputs["calendar"]["range"];
export type CalendarBooking = CalendarRangeData["bookings"][number];
export type CalendarRoom = CalendarRangeData["rooms"][number];
export type CalendarBlock = CalendarRangeData["blocks"][number];
export type MoveResult = RouterOutputs["booking"]["move"];
export type Suggestion = RouterOutputs["booking"]["suggestions"][number];
export type BookingDetails = RouterOutputs["booking"]["details"];
