"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, CalendarDays, Settings, Sun, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ApiProvider } from "@/api/client";
import { Sidebar, type SidebarItem } from "@/ui/Sidebar";
import { Toaster } from "@/ui/Toast";
import { HosthubBanner } from "./HosthubBanner";
import { LogoutButton } from "./LogoutButton";
import { SessionDialog } from "./SessionDialog";
import { SyncIndicator } from "./SyncIndicator";
import { useSyncWhileOpen } from "./useSyncWhileOpen";

/** Until Income is rebuilt (Phase 3), that item opens the current screen. */
const NAV = [
  { href: "/app/today", key: "today", icon: Sun },
  { href: "/app/calendar", key: "calendar", icon: CalendarDays },
  { href: "/app/excel", key: "income", icon: Wallet },
  { href: "/app/settings", key: "settings", icon: Settings },
] as const;

/** Dev mode sections, shown only to an admin with Dev mode switched on (decided on the server). */
const DEV_NAV = [{ href: "/app/dev/apartments", key: "apartments", icon: Building2 }] as const;

export type NewShellProps = {
  textSize: string;
  devMode: boolean;
  children: ReactNode;
};

function ShellInner({ devMode, children }: { devMode: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tDev = useTranslations("dev.nav");
  useSyncWhileOpen();
  const items: SidebarItem[] = NAV.map(({ href, key, icon }) => ({
    href,
    icon,
    label: t(key),
    current: pathname?.startsWith(href) ?? false,
  }));
  const secondary = devMode
    ? {
        label: tDev("label"),
        items: DEV_NAV.map(({ href, key, icon }) => ({
          href,
          icon,
          label: tDev(key),
          current: pathname?.startsWith(href) ?? false,
        })),
      }
    : undefined;
  return (
    <>
      <Sidebar
        items={items}
        linkComponent={Link}
        footer={
          <div className="flex flex-col gap-3">
            <SyncIndicator />
            <LogoutButton />
          </div>
        }
        {...(secondary ? { secondary } : {})}
      />
      <main className="ml-sidebar min-h-screen max-[759px]:ml-0 max-[759px]:pb-20">
        <HosthubBanner />
        {children}
      </main>
      <SessionDialog />
      <Toaster />
    </>
  );
}

/** The redesigned app shell, shown to users with the `newUi` flag. */
export function NewShell({ textSize, devMode, children }: NewShellProps) {
  return (
    <div id="new-ui-root" data-ui="new" data-text-size={textSize}>
      <ApiProvider>
        <ShellInner devMode={devMode}>{children}</ShellInner>
      </ApiProvider>
    </div>
  );
}
