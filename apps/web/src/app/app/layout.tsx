import { NewShell } from "@/features/shell/NewShell";
import { requireAppPolicy } from "@/modules/auth/appAuth";
import { currentUserPreferences } from "@/server/userPreferences";
import "@/ui/theme.css";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const auth = await requireAppPolicy("app_shell");
  const prefs = await currentUserPreferences();

  return (
    <NewShell textSize={prefs.textSize} devMode={prefs.devMode} role={auth.role} userId={auth.userId}>
      {children}
    </NewShell>
  );
}
