import bcrypt from "bcryptjs";

export async function comparePassword(plainText: string, passwordHash: string) {
  // bcryptjs compare is already resistant to timing attacks for the common case.
  return bcrypt.compare(plainText, passwordHash);
}

