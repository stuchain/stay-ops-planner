import type { MessageTree } from "./messages/en";

export type LocaleCode = "en" | "el";

export function getString(tree: MessageTree, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = tree;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === "string" ? cur : undefined;
}
