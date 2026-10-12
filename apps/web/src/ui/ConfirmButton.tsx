"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/ui/Button";

export interface ConfirmButtonProps extends Omit<ButtonProps, "onClick"> {
  /** The question shown in place of the button, e.g. "Restore the built-in text?". */
  question: ReactNode;
  /** Runs only after the person answers yes. */
  onConfirm: () => void;
}

/**
 * A button for something that cannot be undone: the first press turns it into the question with Yes and No,
 * so a stray click never resets or deletes anything.
 */
export function ConfirmButton({
  question,
  onConfirm,
  children,
  loading = false,
  size = "md",
  ...rest
}: ConfirmButtonProps) {
  const t = useTranslations("common");
  const [asking, setAsking] = useState(false);

  if (!asking || loading) {
    return (
      <Button {...rest} size={size} loading={loading} onClick={() => setAsking(true)}>
        {children}
      </Button>
    );
  }
  return (
    <span
      role="group"
      aria-label={typeof question === "string" ? question : undefined}
      className="flex flex-wrap items-center gap-3"
    >
      <span className="text-base">{question}</span>
      <Button
        variant="danger"
        size={size}
        autoFocus
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {t("yes")}
      </Button>
      <Button variant="ghost" size={size} onClick={() => setAsking(false)}>
        {t("no")}
      </Button>
    </span>
  );
}
