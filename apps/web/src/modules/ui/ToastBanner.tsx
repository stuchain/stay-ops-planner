"use client";

import type { ReactNode } from "react";

export type ToastBannerProps = {
  children: ReactNode;
  role?: "status" | "alert";
};

/** Fixed toast strip; use for transient flash messages (matches `.ops-toast`). */
export function ToastBanner({ children, role = "alert" }: ToastBannerProps) {
  return (
    <div className="ops-toast" role={role}>
      {children}
    </div>
  );
}
