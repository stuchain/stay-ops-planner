import { cookies } from "next/headers";
import { verifyAndLoadAuthContext, type AuthContext } from "@/modules/auth/guard";
import { SESSION_COOKIE_NAME } from "@/modules/auth/session";

export type TrpcContext = {
  user: AuthContext | null;
  headers: Headers;
  /** Response headers of the HTTP call, so a procedure can set a cookie; absent for server-side callers. */
  resHeaders?: Headers;
};

export async function createTrpcContext(opts: { headers: Headers; resHeaders?: Headers }): Promise<TrpcContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  return {
    user: await verifyAndLoadAuthContext(token),
    headers: opts.headers,
    ...(opts.resHeaders ? { resHeaders: opts.resHeaders } : {}),
  };
}
