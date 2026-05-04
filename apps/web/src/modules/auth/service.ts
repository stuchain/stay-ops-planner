import { z } from "zod";
import { Prisma } from "@stay-ops/db";
import { prisma } from "@/lib/prisma";
import { AuthError, type AuthErrorCode, jsonError } from "./errors";
import { comparePassword } from "./password";
import { createSessionToken, verifySessionToken, type SessionRole } from "./session";

export const LoginBodySchema = z.object({
  email: z.string().email(),
  // Length policy belongs to account provisioning; login only verifies the stored hash.
  password: z.string().min(1),
});

export type LoginBody = z.infer<typeof LoginBodySchema>;

export const PatchMeBodySchema = z.object({
  uiLocale: z.enum(["en", "el"]),
});

export type PatchMeBody = z.infer<typeof PatchMeBodySchema>;

export type UiLocaleCode = "en" | "el";

type UserRowByEmail = {
  id: string;
  email: string;
  password_hash: string;
  is_active: boolean;
  role: string;
};

type UserRowById = {
  id: string;
  email: string;
  is_active: boolean;
  role: string;
  ui_locale?: string | null;
};

function toSessionRole(value: string): SessionRole {
  if (value === "viewer" || value === "operator" || value === "admin") return value;
  return "operator";
}

function isMissingRoleColumnError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2010") return false;
  const meta = err.meta as { code?: string; message?: string } | undefined;
  return meta?.code === "42703" && typeof meta.message === "string" && meta.message.includes("\"role\"");
}

function isMissingUiLocaleColumnError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2010") return false;
  const meta = err.meta as { code?: string; message?: string } | undefined;
  return meta?.code === "42703" && typeof meta.message === "string" && meta.message.includes("\"ui_locale\"");
}

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

function loginEmailNorm(email: string) {
  return email.trim().toLowerCase();
}

export async function loginWithEmailPassword(body: LoginBody) {
  const emailNorm = loginEmailNorm(body.email);
  let userRows: UserRowByEmail[];
  try {
    // Match stored row case-insensitively (Postgres `=` on text is case-sensitive; throttle already uses `emailNorm`).
    userRows = await prisma.$queryRaw<UserRowByEmail[]>`
      SELECT id, email, password_hash, is_active, role::text as role
      FROM users
      WHERE LOWER(TRIM(email)) = ${emailNorm}
      LIMIT 1
    `;
  } catch (err) {
    if (!isMissingRoleColumnError(err)) throw err;
    // Transitional fallback while DB migrations are catching up.
    const legacyRows = await prisma.$queryRaw<Array<Omit<UserRowByEmail, "role">>>`
      SELECT id, email, password_hash, is_active
      FROM users
      WHERE LOWER(TRIM(email)) = ${emailNorm}
      LIMIT 1
    `;
    userRows = legacyRows.map((row) => ({ ...row, role: "operator" }));
  }

  const user = userRows[0];
  if (!user) throw invalidCredentials();
  if (!user.is_active) throw accountDisabled();

  const ok = await comparePassword(body.password, user.password_hash);
  if (!ok) throw invalidCredentials();

  const role = toSessionRole(user.role);
  const { token, expiresAt } = createSessionToken(user.id, role);

  return {
    token,
    user: { id: user.id, email: user.email, role },
    sessionExpiresAt: expiresAt.toISOString(),
  };
}

export async function getMeFromSessionToken(token: string) {
  const session = verifySessionToken(token);
  if (!session) throw unauthorized();

  let userRows: UserRowById[];
  try {
    userRows = await prisma.$queryRaw<UserRowById[]>`
      SELECT id, email, is_active, role::text as role, ui_locale::text as ui_locale
      FROM users
      WHERE id = ${session.userId}
      LIMIT 1
    `;
  } catch (err) {
    if (isMissingUiLocaleColumnError(err)) {
      try {
        const rows = await prisma.$queryRaw<Omit<UserRowById, "ui_locale">[]>`
          SELECT id, email, is_active, role::text as role
          FROM users
          WHERE id = ${session.userId}
          LIMIT 1
        `;
        userRows = rows.map((row) => ({ ...row, ui_locale: "en" }));
      } catch (err2) {
        if (!isMissingRoleColumnError(err2)) throw err2;
        const legacyRows = await prisma.$queryRaw<Array<Omit<UserRowById, "role" | "ui_locale">>>`
          SELECT id, email, is_active
          FROM users
          WHERE id = ${session.userId}
          LIMIT 1
        `;
        userRows = legacyRows.map((row) => ({ ...row, role: "operator", ui_locale: "en" }));
      }
    } else if (isMissingRoleColumnError(err)) {
      const legacyRows = await prisma.$queryRaw<Array<Omit<UserRowById, "role">>>`
        SELECT id, email, is_active
        FROM users
        WHERE id = ${session.userId}
        LIMIT 1
      `;
      userRows = legacyRows.map((row) => ({ ...row, role: "operator", ui_locale: "en" }));
    } else {
      throw err;
    }
  }

  const user = userRows[0];
  if (!user) throw unauthorized();
  if (!user.is_active) throw accountDisabled();

  const uiLocale: UiLocaleCode = user.ui_locale === "el" ? "el" : "en";

  return {
    user: {
      id: user.id,
      email: user.email,
      role: toSessionRole(user.role),
      uiLocale,
    },
    sessionExpiresAt: session.expiresAt.toISOString(),
  };
}

export async function patchMyUiLocale(userId: string, uiLocale: UiLocaleCode): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { uiLocale },
  });
}

export function assertLogoutTokenPresent(token: string | null) {
  if (!token) throw unauthorized();
}

export { AuthError, type AuthErrorCode, jsonError };

