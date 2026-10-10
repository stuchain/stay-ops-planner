import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { SettingsView } from "@/modules/settings/SettingsView";
import { currentUserPreferences } from "@/server/flags";

export default async function SettingsPage() {
  const { flags } = await currentUserPreferences();
  return flags.newUi ? <SettingsScreen /> : <SettingsView />;
}
