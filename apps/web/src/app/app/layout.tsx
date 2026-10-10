import { NewShell } from "@/features/shell/NewShell";
import { I18nProvider } from "@/i18n/I18nProvider";
import { requireAppPolicy } from "@/modules/auth/appAuth";
import { AppShell } from "@/modules/shell/AppShell";
import { currentUserPreferences } from "@/server/flags";
import "@/ui/theme.css";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireAppPolicy("app_shell");
  const prefs = await currentUserPreferences();

  if (prefs.flags.newUi) {
    // Screens not rebuilt yet still use the old I18n provider inside the new shell.
    return (
      <NewShell textSize={prefs.textSize} devMode={prefs.devMode}>
        <I18nProvider>{children}</I18nProvider>
      </NewShell>
    );
  }
  return <AppShell>{children}</AppShell>;
}
