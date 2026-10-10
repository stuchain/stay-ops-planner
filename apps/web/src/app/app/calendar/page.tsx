import { CalendarScreen } from "@/features/calendar/CalendarScreen";
import { CalendarClient } from "@/modules/calendar/CalendarClient";
import { currentUserPreferences } from "@/server/flags";
import { todayIso } from "@/server/time";

export default async function CalendarPage() {
  const { flags } = await currentUserPreferences();
  return flags.newUi ? <CalendarScreen today={todayIso()} /> : <CalendarClient />;
}
