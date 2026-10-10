import { Loader2, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { buttonBase, buttonVariants, type ButtonVariant } from "@/ui/Button";
import { cn } from "@/ui/cn";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  /** Required accessible name, already translated. */
  label: string;
  icon: LucideIcon;
  variant?: ButtonVariant;
  loading?: boolean;
  loadingLabel?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon: Icon,
    variant = "ghost",
    loading = false,
    loadingLabel,
    className,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  const t = useTranslations("common");
  return (
    <button
      ref={ref}
      type={type}
      aria-label={loading ? `${label} – ${loadingLabel ?? t("pleaseWait")}` : label}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonBase, buttonVariants[variant], "h-target w-target shrink-0 p-0", className)}
      {...rest}
    >
      {loading ? (
        <Loader2 size={24} className="animate-spin" aria-hidden="true" />
      ) : (
        <Icon size={24} aria-hidden="true" />
      )}
    </button>
  );
});
