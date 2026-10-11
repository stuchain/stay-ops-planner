import { CalendarDays, Settings, Sun, Wallet, type LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useTranslations } from "next-intl";
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
  /** A second, smaller group under the main items (the admin's Dev mode sections). Hidden on phones. */
  secondary?: { label: string; items: SidebarItem[] };
  navLabel?: string;
  className?: string;
}

/** The four main screens; `key` names the label under `nav` in the messages. */
const DEFAULT_ITEMS = [
  { href: "/today", key: "today", icon: Sun },
  { href: "/calendar", key: "calendar", icon: CalendarDays },
  { href: "/income", key: "income", icon: Wallet },
  { href: "/settings", key: "settings", icon: Settings },
] as const;

function NavList({
  items,
  Link,
  compact = false,
}: {
  items: SidebarItem[];
  Link: ComponentType<SidebarLinkProps>;
  compact?: boolean;
}) {
  return (
    <ul className={cn("flex flex-col gap-1", !compact && "max-[759px]:flex-row max-[759px]:gap-0")}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.href} className={compact ? undefined : "max-[759px]:flex-1"}>
            <Link
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-sm px-4 font-medium",
                compact
                  ? "text-sm h-11"
                  : "text-base h-14 max-[759px]:h-16 max-[759px]:flex-col max-[759px]:justify-center max-[759px]:gap-0.5 max-[759px]:px-1 max-[759px]:text-xs",
                item.current ? "bg-accent-soft text-accent" : "text-text hover:bg-surface-muted",
              )}
            >
              <Icon size={compact ? 20 : 24} strokeWidth={2} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function PlainLink({ href, children, ...rest }: SidebarLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/** Fixed left navigation (240 px); bottom tabs below 760 px. */
export function Sidebar({
  items: itemsProp,
  linkComponent: Link = PlainLink,
  footer,
  secondary,
  navLabel,
  className,
}: SidebarProps) {
  const t = useTranslations("nav");
  const items: SidebarItem[] = itemsProp ?? DEFAULT_ITEMS.map(({ key, href, icon }) => ({ href, icon, label: t(key) }));
  return (
    <aside
      className={cn(
        "bg-surface border-border w-sidebar fixed print:hidden inset-y-0 left-0 z-30 flex flex-col overflow-y-auto border-r",
        "bg-surface border-border w-sidebar fixed print:hiddeninset-y-0 left-0 z-30 flex flex-col overflow-y-auto border-r",
        "max-[759px]:inset-x-0 max-[759px]:top-auto max-[759px]:bottom-0 max-[759px]:w-full max-[759px]:border-t max-[759px]:border-r-0",
        className,
      )}
    >
      <nav aria-label={navLabel ?? t("label")} className="p-3 max-[759px]:p-1">
        <NavList items={items} Link={Link} />
      </nav>
      {secondary ? (
        <nav aria-labelledby="sidebar-secondary" className="border-border border-t p-3 max-[759px]:hidden">
          <h2
            id="sidebar-secondary"
            className="text-text-muted text-xs px-4 pb-1 font-semibold tracking-wide uppercase"
          >
            {secondary.label}
          </h2>
          <NavList items={secondary.items} Link={Link} compact />
        </nav>
      ) : null}
      {footer ? (
        <div className="border-border text-text-muted mt-auto border-t p-4 text-sm max-[759px]:hidden">{footer}</div>
      ) : null}
    </aside>
  );
}
