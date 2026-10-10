import { redirect } from "next/navigation";
import { TodayScreen } from "@/features/today/TodayScreen";
import { currentUserPreferences } from "@/server/flags";

export default async function TodayPage() {
  const { flags } = await currentUserPreferences();
  // The old UI has no Today screen: its home is the operational dashboard.
  if (!flags.newUi) redirect("/app/dashboard");
  return <TodayScreen />;
}
