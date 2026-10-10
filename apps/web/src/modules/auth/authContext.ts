import type { SessionRole } from "./session";

/** Cookie-backed auth context (JWT in middleware; DB-verified in API via `guard`). */
export type AuthContext = {
  userId: string;
  sessionExpiresAt: Date;
  role: SessionRole;
  /** The 12-hour end of the login (`aexp`); null for older tokens without one. */
  sessionEndsAt?: Date | null;
};
