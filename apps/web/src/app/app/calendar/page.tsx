import { CalendarScreen } from "@/features/calendar/CalendarScreen";
import { todayIso } from "@/server/time";

export default function CalendarPage() {
  return <CalendarScreen today={todayIso()} />;
}
