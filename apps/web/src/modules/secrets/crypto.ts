import crypto from "node:crypto";

type EncryptedBlob = {
  ciphertext: string;
  iv: string;
  tag: string;
};

function keyFromEnv(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY?.trim();
  if (!raw) {
    const fallback = process.env.SESSION_SECRET?.trim();
    if (!fallback) {
      throw new Error("SECRETS_ENCRYPTION_KEY is required");
    }
    // Dev-safe fallback: deterministic key derived from session secret.
    return crypto.createHash("sha256").update(fallback, "utf8").digest();
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SECRETS_ENCRYPTION_KEY must decode to 32 bytes (base64)");
  }
  return key;
}

export function encryptSecret(plaintext: string): EncryptedBlob {
  const key = keyFromEnv();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptSecret(blob: EncryptedBlob): string {
  const key = keyFromEnv();
  const iv = Buffer.from(blob.iv, "base64");
  const ciphertext = Buffer.from(blob.ciphertext, "base64");
  const tag = Buffer.from(blob.tag, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return out.toString("utf8");
}
