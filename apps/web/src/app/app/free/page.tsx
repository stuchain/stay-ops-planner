import { redirect } from "next/navigation";
import { FreeScreen } from "@/features/free/FreeScreen";
import { currentUserPreferences } from "@/server/flags";

export default async function FreePage() {
  const { flags } = await currentUserPreferences();
  // The old UI has no such screen: its home is the operational dashboard.
  if (!flags.newUi) redirect("/app/dashboard");
  return <FreeScreen />;
}
