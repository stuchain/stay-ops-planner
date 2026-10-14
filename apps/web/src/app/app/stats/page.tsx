import { redirect } from "next/navigation";
import { StatisticsScreen } from "@/features/stats/StatisticsScreen";
import { todayIso } from "@/server/time";
import { currentUserPreferences } from "@/server/userPreferences";

/** Statistics is the admin's dashboard: shown only in Dev mode, everyone else goes to Income. */
export default async function StatsPage() {
  const prefs = await currentUserPreferences();
  if (!prefs.devMode) redirect("/app/excel");
  return <StatisticsScreen today={todayIso()} />;
}
