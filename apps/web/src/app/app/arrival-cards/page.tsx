import { ArrivalCardsScreen } from "@/features/arrivalCards/ArrivalCardsScreen";
import { parseIds } from "@/features/arrivalCards/ids";

export default async function ArrivalCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  const { ids } = await searchParams;
  return <ArrivalCardsScreen ids={parseIds(ids)} />;
}
