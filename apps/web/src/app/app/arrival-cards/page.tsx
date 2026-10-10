import { redirect } from "next/navigation";
import { ArrivalCardsScreen } from "@/features/arrivalCards/ArrivalCardsScreen";
import { parseIds } from "@/features/arrivalCards/ids";
import { currentUserPreferences } from "@/server/flags";

export default async function ArrivalCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  const { flags } = await currentUserPreferences();
  // Only the new UI has this page.
  if (!flags.newUi) redirect("/app/dashboard");
  const { ids } = await searchParams;
  return <ArrivalCardsScreen ids={parseIds(ids)} />;
}
