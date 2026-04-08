import { PrismaClient } from "@stay-ops/db";
import { decryptSecret, encryptSecret } from "@/modules/secrets/crypto";

const prisma = new PrismaClient();

const PROVIDER = "hosthub";
const SECRET_KEY = "apiToken";

export type HosthubTokenStatus = {
  configured: boolean;
  updatedAt: string | null;
  name: string | null;
};

export async function getHosthubTokenStatus(): Promise<HosthubTokenStatus> {
  const row = await prisma.integrationSecret.findUnique({
    where: { provider_secretKey: { provider: PROVIDER, secretKey: SECRET_KEY } },
    select: { updatedAt: true, displayName: true },
  });
  return {
    configured: Boolean(row),
    updatedAt: row ? row.updatedAt.toISOString() : null,
    name: row?.displayName ?? null,
  };
}

export async function setHosthubToken(input: { token: string; name?: string | null }): Promise<HosthubTokenStatus> {
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
  if (row) {
    return decryptSecret(row);
  }
  const envToken = process.env.HOSTHUB_API_TOKEN?.trim();
  return envToken && envToken.length > 0 ? envToken : null;
}
