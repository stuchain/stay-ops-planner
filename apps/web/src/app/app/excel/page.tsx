import { IncomeScreen } from "@/features/money/IncomeScreen";
import { todayIso } from "@/server/time";

export default function ExcelPage() {
  return <IncomeScreen today={todayIso()} />;
}
