import type { SessionRole } from "./session";

/** Cookie-backed auth context (JWT in middleware; DB-verified in API via `guard`). */
export type AuthContext = {
  userId: string;
  sessionExpiresAt: Date;
  role: SessionRole;
};
