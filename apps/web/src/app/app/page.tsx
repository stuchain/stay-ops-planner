import { redirect } from "next/navigation";
import { currentUserPreferences } from "@/server/flags";

/** Where a signed-in person lands: Today in the new UI, the calendar for everyone else. */
export default async function AppHomePage() {
  const { flags } = await currentUserPreferences();
  redirect(flags.newUi ? "/app/today" : "/app/calendar");
}
