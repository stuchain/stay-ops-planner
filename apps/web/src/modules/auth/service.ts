import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthError, type AuthErrorCode, jsonError } from "./errors";
import { comparePassword } from "./password";
import { createSessionToken, verifySessionToken } from "./session";

export const LoginBodySchema = z.object({
  email: z.string().email(),
  // Length policy belongs to account provisioning; login only verifies the stored hash.
  password: z.string().min(1),
});

export type LoginBody = z.infer<typeof LoginBodySchema>;

type UserRowByEmail = {
  id: string;
  email: string;
  password_hash: string;
  is_active: boolean;
};

type UserRowById = {
  id: string;
  email: string;
  is_active: boolean;
};

function invalidCredentials(): AuthError {
  return new AuthError({
    code: "INVALID_CREDENTIALS",
    status: 401,
    message: "Invalid email or password",
  });
}

function unauthorized(): AuthError {
  return new AuthError({
    code: "UNAUTHORIZED",
    status: 401,
    message: "Authentication required",
  });
}

function accountDisabled(): AuthError {
  return new AuthError({
    code: "ACCOUNT_DISABLED",
    status: 403,
    message: "Account disabled",
  });
}

export async function loginWithEmailPassword(body: LoginBody) {
  const userRows = await prisma.$queryRaw<UserRowByEmail[]>`
    SELECT id, email, password_hash, is_active
    FROM users
    WHERE email = ${body.email}
    LIMIT 1
  `;

  const user = userRows[0];
  if (!user) throw invalidCredentials();
  if (!user.is_active) throw accountDisabled();

  const ok = await comparePassword(body.password, user.password_hash);
  if (!ok) throw invalidCredentials();

  const { token, expiresAt } = createSessionToken(user.id);

  return {
    token,
    user: { id: user.id, email: user.email },
    sessionExpiresAt: expiresAt.toISOString(),
  };
}

export async function getMeFromSessionToken(token: string) {
  const session = verifySessionToken(token);
  if (!session) throw unauthorized();

  const userRows = await prisma.$queryRaw<UserRowById[]>`
    SELECT id, email, is_active
    FROM users
    WHERE id = ${session.userId}
    LIMIT 1
  `;

  const user = userRows[0];
  if (!user) throw unauthorized();
  if (!user.is_active) throw accountDisabled();

  return {
    user: { id: user.id, email: user.email },
    sessionExpiresAt: session.expiresAt.toISOString(),
  };
}

export function assertLogoutTokenPresent(token: string | null) {
  if (!token) throw unauthorized();
}

export { AuthError, type AuthErrorCode, jsonError };

