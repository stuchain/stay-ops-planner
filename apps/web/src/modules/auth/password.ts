import bcrypt from "bcryptjs";

/** The shortest password a person may choose themselves. */
export const PASSWORD_MIN_LENGTH = 8;

export async function comparePassword(plainText: string, passwordHash: string) {
  // bcryptjs compare is already resistant to timing attacks for the common case.
  return bcrypt.compare(plainText, passwordHash);
}

function bcryptCost(): number {
  const raw = process.env.BCRYPT_COST ?? process.env.BCRYPT_WORK_FACTOR ?? process.env.BCRYPT_ROUNDS;
  const cost = raw ? Number(raw) : 12;
  return Number.isFinite(cost) && cost >= 4 && cost <= 31 ? cost : 12;
}

/** The bcrypt hash stored in `users.password_hash`, with the same cost as `create-user`. */
export async function hashPassword(plainText: string) {
  return bcrypt.hash(plainText, bcryptCost());
}

export function isAcceptablePasswordLength(plainText: string): boolean {
  return plainText.length >= PASSWORD_MIN_LENGTH;
}
