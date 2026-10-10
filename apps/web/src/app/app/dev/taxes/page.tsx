import { TaxRulesEditor } from "@/features/money/TaxRulesEditor";
import { todayIso } from "@/server/time";

export default function DevTaxesPage() {
  return <TaxRulesEditor initialYear={Number(todayIso().slice(0, 4))} />;
}
