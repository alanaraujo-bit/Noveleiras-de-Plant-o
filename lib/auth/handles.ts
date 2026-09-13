import "server-only";

import { randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import { candidatosDeHandle, HANDLE_MAX } from "@/lib/auth/identidade";

/** Livre = ninguém usa, ou quem usa é a própria pessoa. */
export async function handleLivre(handle: string, dono?: string): Promise<boolean> {
  const atual = await db.user.findUnique({ where: { handle }, select: { id: true } });
  return !atual || atual.id === dono;
}

/**
 * O @ mais bonito que ainda está livre. Número só entra quando os nomes
 * limpos já têm dono — e aí dois dígitos, não quatro.
 */
export async function sugerirHandle(nome: string, dono?: string): Promise<string> {
  const candidatos = candidatosDeHandle(nome);
  for (const candidato of candidatos) {
    if (await handleLivre(candidato, dono)) return candidato;
  }

  const raiz = (candidatos[0] ?? "noveleira").slice(0, HANDLE_MAX - 2);
  for (let tentativa = 0; tentativa < 10; tentativa += 1) {
    const candidato = `${raiz}${Math.floor(Math.random() * 90 + 10)}`;
    if (await handleLivre(candidato, dono)) return candidato;
  }
  return `noveleira${randomBytes(4).toString("hex")}`;
}
