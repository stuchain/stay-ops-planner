import { log } from "@stay-ops/shared";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/modules/secrets/crypto";

const PROVIDER = "hosthub";
const SECRET_KEY = "apiToken";

export type HosthubTokenStatus = {
  configured: boolean;
  updatedAt: string | null;
  name: string | null;
};

/**
 * Why sync stops when the stored key cannot be decrypted (it was saved under another SECRETS_ENCRYPTION_KEY or
 * SESSION_SECRET). Starts with HOSTHUB_AUTH_FAILED so the app shows the "Hosthub stopped, enter the key again" banner.
 */
export const UNREADABLE_TOKEN_ERROR =
  "HOSTHUB_AUTH_FAILED: the saved Hosthub key cannot be read with this server's encryption key; save the key again";

/** The stored key in plain text, or null when it cannot be decrypted. */
function tryDecrypt(row: { ciphertext: string; iv: string; tag: string }): string | null {
  try {
    return decryptSecret(row);
  } catch (e) {
    log("error", "hosthub_token_unreadable", { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function getHosthubTokenStatus(): Promise<HosthubTokenStatus> {
  const row = await prisma.integrationSecret.findUnique({
    where: { provider_secretKey: { provider: PROVIDER, secretKey: SECRET_KEY } },
    select: { updatedAt: true, displayName: true, ciphertext: true, iv: true, tag: true },
  });
  return {
    // A key that cannot be decrypted is as good as none: Settings asks for it again.
    configured: Boolean(row && tryDecrypt(row) !== null),
    updatedAt: row ? row.updatedAt.toISOString() : null,
    name: row?.displayName ?? null,
  };
}

export async function setHosthubToken(input: {
  token: string;
  name?: string | null | undefined;
}): Promise<HosthubTokenStatus> {
  const token = input.token;
  const clean = token.trim();
  if (!clean) {
    throw new Error("Token is required");
  }
  const name = input.name?.trim() || null;
  const encrypted = encryptSecret(clean);
  const row = await prisma.integrationSecret.upsert({
    where: { provider_secretKey: { provider: PROVIDER, secretKey: SECRET_KEY } },
    create: {
      provider: PROVIDER,
      secretKey: SECRET_KEY,
      displayName: name,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
    },
    update: {
      displayName: name,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
    },
    select: { updatedAt: true, displayName: true },
  });
  return { configured: true, updatedAt: row.updatedAt.toISOString(), name: row.displayName ?? null };
}

export async function deleteHosthubToken(): Promise<HosthubTokenStatus> {
  await prisma.integrationSecret.deleteMany({
    where: { provider: PROVIDER, secretKey: SECRET_KEY },
  });
  return { configured: false, updatedAt: null, name: null };
}

export async function resolveHosthubApiToken(): Promise<string | null> {
  const row = await prisma.integrationSecret.findUnique({
    where: { provider_secretKey: { provider: PROVIDER, secretKey: SECRET_KEY } },
    select: { ciphertext: true, iv: true, tag: true },
  });
  const envToken = process.env.HOSTHUB_API_TOKEN?.trim() || null;
  if (!row) return envToken;
  const token = tryDecrypt(row);
  if (token !== null) return token;
  if (envToken) return envToken;
  // Every sync would otherwise fail before it starts, silently: record it so the banner and alerts show it.
  await prisma.syncState.upsert({
    where: { id: 1 },
    create: { id: 1, lastError: UNREADABLE_TOKEN_ERROR },
    update: { lastError: UNREADABLE_TOKEN_ERROR },
  });
  return null;
}
