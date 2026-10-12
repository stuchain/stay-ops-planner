"use client";

import { createContext, useContext, type ReactNode } from "react";

export type Role = "viewer" | "operator" | "admin";

const RoleContext = createContext<Role>("operator");

/** The signed-in person's role, from the server layout (the server checks it again on every change). */
export function RoleProvider({ role, children }: { role: Role; children: ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): Role {
  return useContext(RoleContext);
}

/** False for family members (read-only accounts): they see bookings but cannot change them or see money. */
export function useCanChange(): boolean {
  return useRole() !== "viewer";
}
