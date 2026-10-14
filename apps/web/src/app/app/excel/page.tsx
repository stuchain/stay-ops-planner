import { IncomeScreen } from "@/features/money/IncomeScreen";
import { todayIso } from "@/server/time";
import { currentUserPreferences } from "@/server/userPreferences";

export default async function ExcelPage() {
  const prefs = await currentUserPreferences();
  return <IncomeScreen today={todayIso()} devMode={prefs.devMode} />;
}
