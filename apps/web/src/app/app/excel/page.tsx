import { IncomeScreen } from "@/features/money/IncomeScreen";
import { ExcelClient } from "@/modules/excel/ExcelClient";
import { currentUserPreferences } from "@/server/flags";
import { todayIso } from "@/server/time";

export default async function ExcelPage() {
  const { flags } = await currentUserPreferences();
  return flags.newUi ? <IncomeScreen today={todayIso()} /> : <ExcelClient />;
}
