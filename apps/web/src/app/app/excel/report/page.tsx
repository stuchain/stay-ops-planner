import { redirect } from "next/navigation";
import { z } from "zod";
import { AccountantReport } from "@/features/money/AccountantReport";
import { currentUserPreferences } from "@/server/flags";
import { todayIso } from "@/server/time";

const YearSchema = z.coerce.number().int().min(2000).max(2100);

export default async function AccountantReportPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string | string[] }>;
}) {
  const { flags } = await currentUserPreferences();
  // The old UI has no report: its home is the operational dashboard.
  if (!flags.newUi) redirect("/app/dashboard");
  const today = todayIso();
  const { year: raw } = await searchParams;
  const parsed = YearSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
  return <AccountantReport year={parsed.success ? parsed.data : Number(today.slice(0, 4))} today={today} />;
}
