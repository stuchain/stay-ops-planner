import { TaxBracketsSchema } from "@stay-ops/domain";
import { z } from "zod";
import { buildLedger } from "@/server/useCases/buildLedger";
import { saveTaxRules, taxRulesForEditing } from "@/server/useCases/taxRules";
import {
  addManualLedgerRow,
  deleteManualLedgerRow,
  editManualLedgerRow,
  LedgerPatchSchema,
  updateLedgerRow,
} from "@/server/useCases/updateLedger";
import { adminProcedure, createTRPCRouter, operatorProcedure } from "../trpc";

const year = z.number().int().min(2000).max(2100);
const month = z.number().int().min(1).max(12);
const version = z.number().int().nonnegative();
const label = z.string().trim().min(1).max(120);

export const moneyRouter = createTRPCRouter({
  /** The year's ledger, totals and tax estimate. */
  year: operatorProcedure.input(z.object({ year })).query(({ input }) => buildLedger(input.year)),

  /** Correct cells on one row (a booking's, or a manual row's). */
  updateRow: operatorProcedure
    .input(
      z.object({
        target: z.union([z.object({ bookingId: z.string().min(1) }), z.object({ entryId: z.string().min(1) })]),
        expectedVersion: version,
        patch: LedgerPatchSchema,
      }),
    )
    .mutation(({ ctx, input }) => updateLedgerRow({ ...input, actorUserId: ctx.user.userId })),

  addManualRow: operatorProcedure
    .input(z.object({ year, month, label, patch: LedgerPatchSchema.optional() }))
    .mutation(({ ctx, input }) => addManualLedgerRow({ ...input, actorUserId: ctx.user.userId })),

  editManualRow: operatorProcedure
    .input(
      z.object({
        entryId: z.string().min(1),
        expectedVersion: version,
        month: month.optional(),
        label: label.optional(),
      }),
    )
    .mutation(({ ctx, input }) => editManualLedgerRow({ ...input, actorUserId: ctx.user.userId })),

  deleteManualRow: operatorProcedure
    .input(z.object({ entryId: z.string().min(1), expectedVersion: version }))
    .mutation(({ ctx, input }) => deleteManualLedgerRow({ ...input, actorUserId: ctx.user.userId })),

  /** A year's tax brackets for the Dev mode editor (admins only). */
  taxRules: adminProcedure.input(z.object({ year })).query(({ input }) => taxRulesForEditing(input.year)),

  /** Tax brackets for a year (Dev mode, admins only). */
  setTaxRules: adminProcedure
    .input(
      z.object({
        year,
        brackets: TaxBracketsSchema,
        scope: z.enum(["total", "per_apartment"]),
        incomeBasis: z.enum(["gross", "payout"]),
        confirmed: z.boolean(),
        note: z.string().trim().max(500).nullable(),
      }),
    )
    .mutation(({ ctx, input }) => saveTaxRules({ ...input, actorUserId: ctx.user.userId })),
});
