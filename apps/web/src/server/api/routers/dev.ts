import { z } from "zod";
import {
  getHosthubOverview,
  listImportErrors,
  listSyncRuns,
  resetHosthubCursor,
  runHosthubSync,
  saveHosthubToken,
} from "@/server/useCases/devHosthub";
import { rankBooking } from "@/server/useCases/bookingSuggestions";
import {
  loadRecommenderConfig,
  recommenderConfigSchema,
  resetRecommenderConfig,
  saveRecommenderConfig,
} from "@/server/useCases/recommenderConfig";
import { listBookingsForDebug } from "@/server/useCases/recommenderDebug";
import { listApartments, reorderApartments, updateApartment } from "@/server/useCases/apartments";
import { adminProcedure, createTRPCRouter } from "../trpc";
import { historyRouter, systemRouter, usersRouter } from "./devSystem";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Dev mode (P2-5). Every procedure is admin-only on the server; the Dev mode switch only decides what is shown. */
export const devRouter = createTRPCRouter({
  history: historyRouter,
  users: usersRouter,
  system: systemRouter,
  apartments: createTRPCRouter({
    list: adminProcedure.query(() => listApartments()),

    update: adminProcedure
      .input(
        z.object({
          id: z.string().min(1),
          patch: z
            .object({
              name: z.string().trim().min(1).max(60),
              color: hexColor.nullable(),
              capacity: z.number().int().min(1).max(20).nullable(),
              preferredForLargeParty: z.boolean(),
              isActive: z.boolean(),
            })
            .partial(),
        }),
      )
      .mutation(({ ctx, input }) => updateApartment({ ...input, actorUserId: ctx.user.userId })),

    reorder: adminProcedure
      .input(z.object({ ids: z.array(z.string().min(1)).min(1) }))
      .mutation(({ ctx, input }) => reorderApartments({ ids: input.ids, actorUserId: ctx.user.userId })),
  }),

  hosthub: createTRPCRouter({
    overview: adminProcedure.query(() => getHosthubOverview()),

    saveToken: adminProcedure
      .input(z.object({ token: z.string().trim().min(1).max(500), name: z.string().trim().max(120).nullish() }))
      .mutation(({ ctx, input }) => saveHosthubToken({ ...input, actorUserId: ctx.user.userId })),

    runs: adminProcedure
      .input(z.object({ cursor: z.string().min(1).optional(), limit: z.number().int().min(1).max(100).optional() }))
      .query(({ input }) => listSyncRuns(input)),

    errors: adminProcedure
      .input(z.object({ cursor: z.string().min(1).optional(), limit: z.number().int().min(1).max(100).optional() }))
      .query(({ input }) => listImportErrors(input)),

    sync: adminProcedure
      .input(z.object({ full: z.boolean() }))
      .mutation(({ ctx, input }) => runHosthubSync({ full: input.full, actorUserId: ctx.user.userId })),

    resetCursor: adminProcedure.mutation(({ ctx }) => resetHosthubCursor({ actorUserId: ctx.user.userId })),
  }),

  recommender: createTRPCRouter({
    /** The saved rule order and weights (today's behaviour until something is saved). */
    config: adminProcedure.query(() => loadRecommenderConfig()),

    save: adminProcedure
      .input(z.object({ config: recommenderConfigSchema }))
      .mutation(({ ctx, input }) => saveRecommenderConfig({ config: input.config, actorUserId: ctx.user.userId })),

    reset: adminProcedure.mutation(({ ctx }) => resetRecommenderConfig(ctx.user.userId)),

    /** Bookings to pick from: search by guest name, or the upcoming ones that need an apartment first. */
    bookings: adminProcedure
      .input(z.object({ query: z.string().max(80).optional() }))
      .query(({ input }) => listBookingsForDebug(input.query === undefined ? {} : { query: input.query })),

    /** Every apartment for one booking with each rule's contribution. `config` tries unsaved rules. */
    debug: adminProcedure
      .input(z.object({ bookingId: z.string().min(1), config: recommenderConfigSchema.optional() }))
      .query(({ input }) => rankBooking(input.bookingId, input.config)),
  }),
});
