import { Check } from "lucide-react";
import { cn } from "@/ui/cn";

export type Choice<T extends string> = { value: T; label: string };

export type ChoiceGroupProps<T extends string> = {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
};

/** A few big buttons, one of which is chosen (a radio group a finger can hit). */
export function ChoiceGroup<T extends string>({ label, value, choices, onChange, disabled }: ChoiceGroupProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-3">
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
              "min-h-button rounded-sm border-2 px-6 text-base font-semibold transition-colors",
              "inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-55",
              chosen
                ? "border-accent bg-accent-soft text-accent"
                : "border-border bg-surface text-text hover:bg-surface-muted",
            )}
          >
            {chosen ? <Check size={24} aria-hidden="true" /> : null}
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}
