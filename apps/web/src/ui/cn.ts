import { clsx, type ClassValue } from "clsx";

/** Joins class names, skipping falsy ones. */
export function cn(...values: ClassValue[]): string {
  return clsx(values);
}
