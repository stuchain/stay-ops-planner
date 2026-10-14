import { Check } from "lucide-react";
import { cn } from "@/ui/cn";

export type Choice<T extends string> = { value: T; label: string };

export type ChoiceGroupProps<T extends string> = {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** lg (default): 56 px buttons for settings-style choices; md: 44 px, for toolbars and card headers. */
  size?: "md" | "lg";
  className?: string;
};

/**
 * A few buttons, one of which is chosen (a radio group a finger can hit). The one look for "this one is chosen"
 * everywhere: light accent fill, accent border and a tick, so it never relies on colour alone.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  choices,
  onChange,
  disabled,
  size = "lg",
  className,
}: ChoiceGroupProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("flex flex-wrap", size === "lg" ? "gap-3" : "gap-2", className)}
    >
      {choices.map((choice) => {
        const chosen = choice.value === value;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            disabled={disabled}
            onClick={() => {
              if (!chosen) onChange(choice.value);
            }}
            className={cn(
              "rounded-sm border-2 font-semibold transition-colors",
              size === "lg" ? "min-h-button px-6 text-base" : "min-h-target px-4 text-sm",
              "inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-55",
              chosen
                ? "border-accent bg-accent-soft text-accent"
                : "border-border bg-surface text-text hover:bg-surface-muted",
            )}
          >
            {chosen ? <Check size={size === "lg" ? 24 : 20} aria-hidden="true" /> : null}
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}
