import { redirect } from "next/navigation";
import { isIsoDate, type IsoDate } from "@stay-ops/domain";
import { sheetStart, type PrintView } from "@/features/print/layout";
import { PrintSheet } from "@/features/print/PrintSheet";
import { currentUserPreferences } from "@/server/flags";
import { todayIso } from "@/server/time";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function CalendarPrintPage({ searchParams }: { searchParams: SearchParams }) {
  const { flags } = await currentUserPreferences();
  // The old UI has no printable sheet: its home is the operational dashboard.
  if (!flags.newUi) redirect("/app/dashboard");
  const params = await searchParams;
  const view: PrintView = first(params.view) === "month" ? "month" : "week";
  const requested = first(params.from);
  const date: IsoDate = requested && isIsoDate(requested) ? requested : todayIso();
  return <PrintSheet view={view} from={sheetStart(view, date)} />;
}
