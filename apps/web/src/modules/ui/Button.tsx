"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

const variantClass: Record<ButtonVariant, string> = {
  primary: "ops-btn ops-btn-primary",
  secondary: "ops-btn",
  danger: "ops-btn ops-btn-danger",
  ghost: "ops-btn ops-btn-ghost",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "ops-btn-small",
  md: "",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  loadingLabel = "Working…",
  children,
  className = "",
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const busy = Boolean(loading);
  const classes = [variantClass[variant], sizeClass[size], className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} disabled={disabled || busy} {...rest}>
      {busy ? loadingLabel : children}
    </button>
  );
}
