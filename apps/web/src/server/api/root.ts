import { createCallerFactory, createTRPCRouter } from "./trpc";
import { bookingRouter } from "./routers/booking";
import { calendarRouter } from "./routers/calendar";
import { meRouter } from "./routers/me";

export const appRouter = createTRPCRouter({
  me: meRouter,
  calendar: calendarRouter,
  booking: bookingRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
