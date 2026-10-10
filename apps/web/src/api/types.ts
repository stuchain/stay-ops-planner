import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/api/root";

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export type CalendarRangeData = RouterOutputs["calendar"]["range"];
export type CalendarBooking = CalendarRangeData["bookings"][number];
export type CalendarRoom = CalendarRangeData["rooms"][number];
export type CalendarBlock = CalendarRangeData["blocks"][number];
export type ArrangeProposal = RouterOutputs["calendar"]["arrangePreview"];
export type ArrangePlacement = ArrangeProposal["placements"][number];
export type TodaySummary = RouterOutputs["today"]["summary"];
export type AvailabilityData = RouterOutputs["availability"]["check"];
export type AvailabilityRoom = AvailabilityData["rooms"][number];
export type TodayStay = TodaySummary["arrivals"][number];
export type MoveResult = RouterOutputs["booking"]["move"];
export type Suggestion = RouterOutputs["booking"]["suggestions"][number];
export type BookingDetails = RouterOutputs["booking"]["details"];
export type PreviousStays = RouterOutputs["booking"]["previousStays"];
export type LedgerYearData = RouterOutputs["money"]["year"];
export type LedgerRowData = LedgerYearData["rows"][number];
export type LedgerApartmentData = LedgerYearData["apartments"][number];
export type TaxRulesEditData = RouterOutputs["money"]["taxRules"];
export type ApartmentRow = RouterOutputs["dev"]["apartments"]["list"][number];

export type SyncRunRow = RouterOutputs["dev"]["hosthub"]["runs"]["items"][number];
export type ImportErrorRow = RouterOutputs["dev"]["hosthub"]["errors"]["items"][number];
