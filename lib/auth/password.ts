import bcrypt from "bcryptjs";

const ROUNDS = 11;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// O @ nasce de `sugerirHandle` em `lib/auth/handles.ts`.
