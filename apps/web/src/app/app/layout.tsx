import { requireAppPolicy } from "@/modules/auth/appAuth";
import { AppShell } from "@/modules/shell/AppShell";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireAppPolicy("app_shell");

  return <AppShell>{children}</AppShell>;
}
