import { redirect } from "next/navigation";
import { TurnoversScreen } from "@/features/turnovers/TurnoversScreen";
import { currentUserPreferences } from "@/server/flags";

export default async function TurnoversPage() {
  const { flags } = await currentUserPreferences();
  // The old UI keeps its own cleaning board at /app/cleaning.
  if (!flags.newUi) redirect("/app/dashboard");
  return <TurnoversScreen />;
}
