import { redirect } from "next/navigation";
import { CleaningBoard } from "@/modules/cleaning/CleaningBoard";
import { currentUserPreferences } from "@/server/flags";

export default async function CleaningPage() {
  // In the new UI cleaning lives under Dev mode (/app/dev/cleaning) until Phase 4.
  const prefs = await currentUserPreferences();
  if (prefs.flags.newUi) redirect(prefs.devMode ? "/app/dev/cleaning" : "/app/today");
  return <CleaningBoard />;
}
