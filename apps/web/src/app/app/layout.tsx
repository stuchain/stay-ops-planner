import Link from "next/link";
import { requireAppPolicy } from "@/modules/auth/appAuth";
import { SyncHeartbeat } from "@/modules/sync/SyncHeartbeat";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireAppPolicy("app_shell");

  return (
    <div className="ops-shell">
      <SyncHeartbeat />
      <header className="ops-shell-header" role="banner">
        <nav className="ops-shell-nav" aria-label="Main menu">
          <Link className="ops-shell-link" href="/app/calendar">
            Calendar
          </Link>
          <Link className="ops-shell-link" href="/app/cleaning">
            Cleaning
          </Link>
          <Link className="ops-shell-link" href="/app/bookings">
            Bookings
          </Link>
          <Link className="ops-shell-link" href="/app/excel">
            Excel
          </Link>
          <Link className="ops-shell-link" href="/app/settings">
            Settings
          </Link>
        </nav>
      </header>
      <div className="ops-shell-content">{children}</div>
    </div>
  );
}
