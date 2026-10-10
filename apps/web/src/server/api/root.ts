import { createCallerFactory, createTRPCRouter } from "./trpc";
import { bookingRouter } from "./routers/booking";
import { calendarRouter } from "./routers/calendar";
import { meRouter } from "./routers/me";
import { moneyRouter } from "./routers/money";
import { syncRouter } from "./routers/sync";

export const appRouter = createTRPCRouter({
  me: meRouter,
  calendar: calendarRouter,
  booking: bookingRouter,
  sync: syncRouter,
  money: moneyRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
