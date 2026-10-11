import { redirect } from "next/navigation";
import { currentUserPreferences } from "@/server/userPreferences";

export default async function CleaningPage() {
  // Cleaning lives under Dev mode (/app/dev/cleaning) until Phase 4.
  const prefs = await currentUserPreferences();
  redirect(prefs.devMode ? "/app/dev/cleaning" : "/app/today");
}
