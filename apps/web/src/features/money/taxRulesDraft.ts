import { parseEuroInput, type TaxBracket } from "@stay-ops/domain";
import { formatMoney } from "@/ui/format";

/** One bracket as typed: the upper limit in euros (empty on the last, open-ended one) and the rate in %. */
export type BracketDraft = { limit: string; rate: string };

export type BracketError = "limitInvalid" | "limitNotRising" | "rateInvalid";

export type DraftCheck =
  | { ok: true; brackets: TaxBracket[] }
  | { ok: false; errors: { index: number; field: "limit" | "rate"; code: BracketError }[] };

/** Rates are typed as percent ("15", "15,5", "22.75 %") and stored in basis points. */
export function parseRateInput(text: string): number | null {
  const t = text.replace(/%/g, "").trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const bps = Math.round(Number(t) * 100);
  return bps <= 10_000 ? bps : null;
}

/** Basis points back to the way a rate is typed: 1550 becomes "15,5". */
export function formatRateInput(rateBps: number): string {
  return (rateBps / 100).toLocaleString("el-GR", { maximumFractionDigits: 2, useGrouping: false });
}

/** Limits are prefilled in the Greek format, which `parseEuroInput` reads back exactly. */
export function draftFromBrackets(brackets: readonly TaxBracket[]): BracketDraft[] {
  return brackets.map((b) => ({
    limit: b.upToCents === null ? "" : formatMoney(b.upToCents, "el").replace(/\s*€/, ""),
    rate: formatRateInput(b.rateBps),
  }));
}

/** A new bracket goes just before the open-ended one, with the same rate to start from. */
export function addBracket(draft: readonly BracketDraft[]): BracketDraft[] {
  const last = draft[draft.length - 1] ?? { limit: "", rate: "" };
  return [...draft.slice(0, -1), { limit: "", rate: last.rate }, { ...last, limit: "" }];
}

/** Removes a bracket; the last remaining one is always open-ended. */
export function removeBracket(draft: readonly BracketDraft[], index: number): BracketDraft[] {
  if (draft.length <= 1) return [...draft];
  const next = draft.filter((_, i) => i !== index);
  return next.map((b, i) => (i === next.length - 1 ? { ...b, limit: "" } : b));
}

/** Checks the whole draft. Limits must be positive and rise; every rate must be 0–100 %. */
export function checkDraft(draft: readonly BracketDraft[]): DraftCheck {
  const errors: { index: number; field: "limit" | "rate"; code: BracketError }[] = [];
  const brackets: TaxBracket[] = [];
  let previous = 0;
  draft.forEach((b, index) => {
    const open = index === draft.length - 1;
    let upToCents: number | null = null;
    if (!open) {
      const parsed = parseEuroInput(b.limit);
      if (!parsed.ok || parsed.cents <= 0) {
        errors.push({ index, field: "limit", code: "limitInvalid" });
      } else if (parsed.cents <= previous) {
        errors.push({ index, field: "limit", code: "limitNotRising" });
      } else {
        upToCents = parsed.cents;
        previous = parsed.cents;
      }
    }
    const rateBps = parseRateInput(b.rate);
    if (rateBps === null) errors.push({ index, field: "rate", code: "rateInvalid" });
    brackets.push({ upToCents, rateBps: rateBps ?? 0 });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, brackets };
}
