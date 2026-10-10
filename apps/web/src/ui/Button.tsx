import { Loader2, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/ui/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

export const buttonBase =
  "relative inline-flex items-center justify-center gap-2 rounded-sm border font-semibold " +
  "whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-55";

export const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent border-accent text-white dark:text-bg hover:brightness-110 active:brightness-95",
  secondary: "bg-surface border-border text-text hover:bg-surface-muted",
  ghost: "bg-transparent border-transparent text-text hover:bg-surface-muted",
  danger: "bg-danger border-danger text-white dark:text-bg hover:brightness-110 active:brightness-95",
};

export const buttonSizes: Record<ButtonSize, string> = {
  md: "min-h-target px-4 text-sm",
  lg: "min-h-button px-6 text-base",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button and shows a spinner; the width is kept. */
  loading?: boolean;
  /** Visually hidden text announced while loading. */
  loadingLabel?: string;
  /** Optional leading Lucide icon. */
  icon?: LucideIcon;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    loadingLabel,
    icon: Icon,
    className,
    disabled,
    type = "button",
    children,
    ...rest
  },
  ref,
) {
  const t = useTranslations("common");
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...rest}
    >
      <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
        {Icon ? <Icon size={24} aria-hidden="true" /> : null}
        {children}
      </span>
      {loading ? (
        <span className="absolute inset-0 inline-flex items-center justify-center">
          <Loader2 size={24} className="animate-spin" aria-hidden="true" />
          <span className="sr-only">{loadingLabel ?? t("pleaseWait")}</span>
        </span>
      ) : null}
    </button>
  );
});
