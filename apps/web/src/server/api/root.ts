import { createCallerFactory, createTRPCRouter } from "./trpc";
import { adminRouter } from "./routers/admin";
import { bookingRouter } from "./routers/booking";
import { calendarRouter } from "./routers/calendar";
import { devRouter } from "./routers/dev";
import { meRouter } from "./routers/me";
import { moneyRouter } from "./routers/money";
import { syncRouter } from "./routers/sync";

export const appRouter = createTRPCRouter({
  me: meRouter,
  admin: adminRouter,
  calendar: calendarRouter,
  booking: bookingRouter,
  sync: syncRouter,
  dev: devRouter,
  money: moneyRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
