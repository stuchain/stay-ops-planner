import { createCallerFactory, createTRPCRouter } from "./trpc";
import { availabilityRouter } from "./routers/availability";
import { adminRouter } from "./routers/admin";
import { bookingRouter } from "./routers/booking";
import { calendarRouter } from "./routers/calendar";
import { devRouter } from "./routers/dev";
import { helpRouter } from "./routers/help";
import { meRouter } from "./routers/me";
import { moneyRouter } from "./routers/money";
import { syncRouter } from "./routers/sync";
import { todayRouter } from "./routers/today";

export const appRouter = createTRPCRouter({
  me: meRouter,
  admin: adminRouter,
  calendar: calendarRouter,
  booking: bookingRouter,
  sync: syncRouter,
  dev: devRouter,
  money: moneyRouter,
  today: todayRouter,
  help: helpRouter,
  availability: availabilityRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
