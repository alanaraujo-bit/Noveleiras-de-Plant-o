import bcrypt from "bcryptjs";

import { normalizeText } from "@/lib/text";

const ROUNDS = 11;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Deriva um @arroba estável e legível a partir do nome. */
export function handleFromName(name: string): string {
  const base = normalizeText(name).replace(/\s+/g, "").slice(0, 14);
  const seed = Math.floor(Math.random() * 9000 + 1000);
  return `${base || "noveleira"}${seed}`;
}
