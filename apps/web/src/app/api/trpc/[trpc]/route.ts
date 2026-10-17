import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/api/root";
import { createTrpcContext } from "@/server/api/context";

export const dynamic = "force-dynamic";

function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    // Lets the client send the guest search as POST, so what was typed stays out of URLs and request logs.
    allowMethodOverride: true,
    createContext: ({ resHeaders }) => createTrpcContext({ headers: req.headers, resHeaders }),
  });
}

export { handler as GET, handler as POST };
