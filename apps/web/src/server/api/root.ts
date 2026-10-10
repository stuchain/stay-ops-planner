import { createCallerFactory, createTRPCRouter } from "./trpc";
import { meRouter } from "./routers/me";

export const appRouter = createTRPCRouter({
  me: meRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
