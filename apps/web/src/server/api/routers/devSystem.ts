import { z } from "zod";
import { auditCsv, auditFilterOptions, listAuditEvents } from "@/server/useCases/auditLog";
import { systemInfo } from "@/server/useCases/devSystem";
import {
  listUsers,
  setUserPassword,
  signOutUserEverywhere,
  unlockUser,
  updateUserFlags,
} from "@/server/useCases/devUsers";
import { FLAG_KEYS } from "@/server/flags";
import { adminProcedure, createTRPCRouter } from "../trpc";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optional = z.string().trim().min(1).max(200).optional();

const filters = z.object({
  from: day.optional(),
  to: day.optional(),
  entityType: optional,
  action: optional,
  userId: optional,
  bookingId: optional,
});

/** Dev mode History (P2-6): the audit log. Admin only. */
export const historyRouter = createTRPCRouter({
  options: adminProcedure.query(() => auditFilterOptions()),
  list: adminProcedure
    .input(z.object({ filters, page: z.number().int().min(1).max(100_000).default(1) }))
    .query(({ input }) => listAuditEvents(input.filters, input.page)),
  exportCsv: adminProcedure.input(z.object({ filters })).mutation(({ input }) => auditCsv(input.filters)),
});

/** Dev mode Users (P2-6): passwords, sign-outs, lockouts and per-user flags. Admin only. */
export const usersRouter = createTRPCRouter({
  list: adminProcedure.query(async () => ({ users: await listUsers(), flagKeys: [...FLAG_KEYS] })),
  setPassword: adminProcedure
    .input(z.object({ userId: z.string().min(1), newPassword: z.string().min(1).max(200) }))
    .mutation(({ ctx, input }) => setUserPassword({ actorUserId: ctx.user.userId, ...input })),
  unlock: adminProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(({ ctx, input }) => unlockUser({ actorUserId: ctx.user.userId, userId: input.userId })),
  signOutEverywhere: adminProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(({ ctx, input }) => signOutUserEverywhere({ actorUserId: ctx.user.userId, userId: input.userId })),
  updateFlags: adminProcedure
    .input(z.object({ userId: z.string().min(1), patch: z.object({ newUi: z.boolean().optional() }) }))
    .mutation(({ ctx, input }) => updateUserFlags({ actorUserId: ctx.user.userId, ...input })),
});

/** Dev mode System (P2-6): version, database and Sentry. Admin only. */
export const systemRouter = createTRPCRouter({
  info: adminProcedure.query(() => systemInfo()),
});
