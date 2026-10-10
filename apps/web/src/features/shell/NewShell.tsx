"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Settings, Sun, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ApiProvider } from "@/api/client";
import { Sidebar, type SidebarItem } from "@/ui/Sidebar";
import { Toaster } from "@/ui/Toast";
import { SyncIndicator } from "./SyncIndicator";
import { useSyncWhileOpen } from "./useSyncWhileOpen";

/** Until Σήμερα and Έσοδα are rebuilt (Phase 2 and 3), those items open the current screens. */
const NAV = [
  { href: "/app/dashboard", key: "today", icon: Sun },
  { href: "/app/calendar", key: "calendar", icon: CalendarDays },
  { href: "/app/excel", key: "income", icon: Wallet },
  { href: "/app/settings", key: "settings", icon: Settings },
] as const;

export type NewShellProps = {
  textSize: string;
  children: ReactNode;
};

function ShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  useSyncWhileOpen();
  const items: SidebarItem[] = NAV.map(({ href, key, icon }) => ({
    href,
    icon,
    label: t(key),
    current: pathname?.startsWith(href) ?? false,
  }));
  return (
    <>
      <Sidebar items={items} linkComponent={Link} footer={<SyncIndicator />} />
      <main className="ml-sidebar min-h-screen max-[759px]:ml-0 max-[759px]:pb-20">{children}</main>
      <Toaster />
    </>
  );
}

/** The redesigned app shell, shown to users with the `newUi` flag. */
export function NewShell({ textSize, children }: NewShellProps) {
  return (
    <div id="new-ui-root" data-ui="new" data-text-size={textSize}>
      <ApiProvider>
        <ShellInner>{children}</ShellInner>
      </ApiProvider>
    </div>
  );
}
