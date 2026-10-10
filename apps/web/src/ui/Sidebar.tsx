import { CalendarDays, Settings, Sun, Wallet, type LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/ui/cn";

export interface SidebarItem {
  href: string;
  label: string;
  icon: LucideIcon;
  current?: boolean;
}

export type SidebarLinkProps = {
  href: string;
  className?: string;
  "aria-current"?: "page" | undefined;
  children?: ReactNode;
};

export interface SidebarProps {
  items?: SidebarItem[];
  /** Link renderer, e.g. next/link. Defaults to a plain <a>. */
  linkComponent?: ComponentType<SidebarLinkProps>;
  /** Slot at the bottom (e.g. "last updated" indicator). Hidden on phones. */
  footer?: ReactNode;
  navLabel?: string;
  className?: string;
}

export const defaultSidebarItems: SidebarItem[] = [
  { href: "/today", label: "Σήμερα", icon: Sun },
  { href: "/calendar", label: "Ημερολόγιο", icon: CalendarDays },
  { href: "/income", label: "Έσοδα", icon: Wallet },
  { href: "/settings", label: "Ρυθμίσεις", icon: Settings },
];

function PlainLink({ href, children, ...rest }: SidebarLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/** Fixed left navigation (240 px); bottom tabs below 760 px. */
export function Sidebar({
  items = defaultSidebarItems,
  linkComponent: Link = PlainLink,
  footer,
  navLabel = "Κύρια πλοήγηση",
  className,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        "bg-surface border-border w-sidebar fixed inset-y-0 left-0 z-30 flex flex-col border-r",
        "max-[759px]:inset-x-0 max-[759px]:top-auto max-[759px]:bottom-0 max-[759px]:w-full max-[759px]:border-t max-[759px]:border-r-0",
        className,
      )}
    >
      <nav aria-label={navLabel} className="p-3 max-[759px]:p-1">
        <ul className="flex flex-col gap-1 max-[759px]:flex-row max-[759px]:gap-0">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href} className="max-[759px]:flex-1">
                <Link
                  href={item.href}
                  aria-current={item.current ? "page" : undefined}
                  className={cn(
                    "text-base flex h-14 items-center gap-3 rounded-sm px-4 font-medium",
                    "max-[759px]:h-16 max-[759px]:flex-col max-[759px]:justify-center max-[759px]:gap-0.5 max-[759px]:px-1 max-[759px]:text-xs",
                    item.current ? "bg-accent-soft text-accent" : "text-text hover:bg-surface-muted",
                  )}
                >
                  <Icon size={24} strokeWidth={2} aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {footer ? (
        <div className="border-border text-text-muted mt-auto border-t p-4 text-sm max-[759px]:hidden">{footer}</div>
      ) : null}
    </aside>
  );
}
