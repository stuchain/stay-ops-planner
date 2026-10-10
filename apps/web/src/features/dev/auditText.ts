import type { RouterOutputs } from "@/api/types";
import { historySentence, type HistoryTranslator, type UiLocale } from "@/features/calendar/historyText";

export type AuditRow = RouterOutputs["dev"]["history"]["list"]["items"][number];

/** A key under `dev.history.actions`: the action with its dots turned into underscores. */
export function actionKey(action: string): string {
  return action.replace(/[^A-Za-z0-9]+/g, "_");
}

export type AuditTranslators = {
  /** The booking panel sentences (`history`). */
  booking: HistoryTranslator;
  /** `dev.history.actions`; `has` says whether this action has a sentence of its own. */
  action: { (key: string): string; has: (key: string) => boolean };
  /** `dev.history.actions` fallback for an action nobody wrote a sentence for. */
  unknown: () => string;
};

/**
 * One readable sentence for one audit row. Booking changes read the same as in the booking panel; other
 * actions have their own sentence; anything else says only that a change was made (the raw action stays
 * in the expanded details).
 */
export function auditSentence(row: AuditRow, t: AuditTranslators, locale: UiLocale, now: Date = new Date()): string {
  if (row.event.kind !== "other") {
    return historySentence({ id: row.id, at: row.at, event: row.event }, t.booking, locale, now);
  }
  const key = actionKey(row.action);
  return t.action.has(key) ? t.action(key) : t.unknown();
}
