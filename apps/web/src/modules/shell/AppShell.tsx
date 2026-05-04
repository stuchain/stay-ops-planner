"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { I18nProvider, useI18n } from "@/i18n/I18nProvider";
import { SyncHeartbeat } from "@/modules/sync/SyncHeartbeat";

function AppShellNav() {
  const { t } = useI18n();
  return (
    <nav className="ops-shell-nav" aria-label="Main menu">
      <Link className="ops-shell-link" href="/app/calendar">
        {t("nav.calendar")}
      </Link>
      <Link className="ops-shell-link" href="/app/cleaning">
        {t("nav.cleaning")}
      </Link>
      <Link className="ops-shell-link" href="/app/bookings">
        {t("nav.bookings")}
      </Link>
      <Link className="ops-shell-link" href="/app/excel">
        {t("nav.excel")}
      </Link>
      <Link className="ops-shell-link" href="/app/settings">
        {t("nav.settings")}
      </Link>
    </nav>
  );
}

function AppShellInner({ children }: { children: ReactNode }) {
  return (
    <div id="ops-app-root" className="ops-shell">
      <SyncHeartbeat />
      <header className="ops-shell-header" role="banner">
        <AppShellNav />
      </header>
      <div className="ops-shell-content">{children}</div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <AppShellInner>{children}</AppShellInner>
    </I18nProvider>
  );
}
