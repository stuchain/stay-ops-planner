import * as Sentry from "@sentry/nextjs";
import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { DomainError, type DomainErrorCode, type DomainErrorParams } from "@/server/errors";
import type { TrpcContext } from "./context";

const TRPC_TO_DOMAIN: Partial<Record<TRPCError["code"], DomainErrorCode>> = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  BAD_REQUEST: "VALIDATION",
  PARSE_ERROR: "VALIDATION",
};

/** The code and safe params the client translates; never the raw message. */
export function domainErrorShape(error: TRPCError): { code: DomainErrorCode; params: DomainErrorParams } {
  if (error.cause instanceof DomainError) return { code: error.cause.code, params: error.cause.params };
  if (error.cause instanceof ZodError) return { code: "VALIDATION", params: {} };
  return { code: TRPC_TO_DOMAIN[error.code] ?? "INTERNAL", params: {} };
}

const t = initTRPC.context<TrpcContext>().create({
  errorFormatter({ shape, error }) {
    const domain = domainErrorShape(error);
    return {
      ...shape,
      message: domain.code,
      data: { code: shape.data.code, httpStatus: shape.data.httpStatus, path: shape.data.path, domain },
    };
  },
});

function httpCodeFor(code: DomainErrorCode): TRPCError["code"] {
  switch (code) {
    case "UNAUTHORIZED":
    case "FORBIDDEN":
    case "NOT_FOUND":
      return code;
    case "VALIDATION":
    case "INVALID_STAY":
      return "BAD_REQUEST";
    case "INTERNAL":
    case "HOSTHUB_DISCONNECTED":
      return "INTERNAL_SERVER_ERROR";
    default:
      return "CONFLICT";
  }
}

/** Gives a thrown DomainError the right HTTP status instead of a 500. */
const domainErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof DomainError) {
    const cause = result.error.cause;
    throw new TRPCError({ code: httpCodeFor(cause.code), message: cause.code, cause });
  }
  return result;
});

/** Tags each Sentry event with the procedure name and reports unexpected errors. */
const sentry = t.middleware(async ({ path, type, next }) => {
  return Sentry.withScope(async (scope) => {
    scope.setTag("trpc.procedure", path);
    scope.setTag("trpc.type", type);
    const result = await next();
    if (!result.ok && !(result.error.cause instanceof DomainError) && result.error.code === "INTERNAL_SERVER_ERROR") {
      Sentry.captureException(result.error.cause ?? result.error);
    }
    return result;
  });
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

const baseProcedure = t.procedure.use(sentry).use(domainErrors);

export const publicProcedure = baseProcedure;

/** Any signed-in user. */
export const userProcedure = baseProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new DomainError("UNAUTHORIZED");
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Can change bookings: operators and admins. */
export const operatorProcedure = userProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "operator" && ctx.user.role !== "admin") throw new DomainError("FORBIDDEN");
  return next();
});

/** Admins only, checked on the server. Dev mode never grants anything. */
export const adminProcedure = userProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new DomainError("FORBIDDEN");
  return next();
});
