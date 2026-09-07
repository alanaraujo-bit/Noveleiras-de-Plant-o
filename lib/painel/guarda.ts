import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db";
import { getViewer } from "@/lib/auth/session";
import {
  permissoesEfetivas,
  temPermissao,
  type Permissao,
} from "@/lib/painel/permissoes";

/**
 * A autoridade de acesso ao painel.
 *
 * `proxy.ts` também barra /painel, mas isso é conveniência de navegação: ele
 * roda antes de a sessão ser realmente resolvida e não pode ser a única
 * defesa. Quem decide é este módulo, chamado dentro de **cada** página, ação
 * de servidor e rota do painel. Sem exceção — uma tela que esquece de chamar
 * `exigirPermissao` é um buraco, não um descuido.
 *
 * Não usamos `forbidden()` do Next porque ele exige a flag experimental
 * `authInterrupts`: o caminho de autorização do produto não vai depender de
 * uma flag instável. Falta de permissão vira uma tela nossa, que diz qual
 * permissão falta — dentro de uma equipe, isso é mais útil que um 403 mudo.
 */

export type Operador = {
  id: string;
  nome: string;
  email: string;
  handle: string;
  avatarSeed: string;
  role: "USER" | "EDITOR" | "ADMIN";
  permissoes: Permissao[];
  pode: (permissao: Permissao) => boolean;
};

/** Operador atual, ou null. Memoizado por requisição. */
export const obterOperador = cache(async (): Promise<Operador | null> => {
  const viewer = await getViewer();
  if (!viewer) return null;
  if (viewer.role !== "ADMIN" && viewer.role !== "EDITOR") return null;

  const registro = await db.user.findUnique({
    where: { id: viewer.id },
    select: { permissions: true },
  });

  const permissoes = permissoesEfetivas(viewer.role, registro?.permissions ?? []);

  return {
    id: viewer.id,
    nome: viewer.name,
    email: viewer.email,
    handle: viewer.handle,
    avatarSeed: viewer.avatarSeed,
    role: viewer.role,
    permissoes,
    pode: (permissao: Permissao) => temPermissao(permissoes, permissao),
  };
});

/**
 * Exige um operador. Quem não está autenticado vai para o login; quem está
 * autenticado mas não é da equipe recebe 404 — anunciar que /painel existe
 * para quem não deveria alcançá-lo é entregar o mapa de graça.
 */
export async function exigirPainel(): Promise<Operador> {
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar?destino=/painel");

  const operador = await obterOperador();
  if (!operador) notFound();
  return operador;
}

/** Exige uma permissão específica. Use no topo de cada página do painel. */
export async function exigirPermissao(permissao: Permissao): Promise<Operador> {
  const operador = await exigirPainel();
  if (!operador.pode(permissao)) {
    redirect(`/painel/sem-acesso?permissao=${encodeURIComponent(permissao)}`);
  }
  return operador;
}

/**
 * Versão para ações de servidor: lança em vez de redirecionar, para que a ação
 * devolva um erro tratável em vez de uma navegação no meio de um envio.
 */
export class SemPermissao extends Error {
  constructor(public readonly permissao: Permissao) {
    super(`Sem permissão: ${permissao}`);
    this.name = "SemPermissao";
  }
}

export async function exigirPermissaoNaAcao(
  permissao: Permissao,
): Promise<Operador> {
  const operador = await obterOperador();
  if (!operador || !operador.pode(permissao)) throw new SemPermissao(permissao);
  return operador;
}

/** Para rotas de API do painel: devolve o operador ou uma resposta 401/403. */
export async function operadorDaRota(
  permissao: Permissao,
): Promise<{ operador: Operador; resposta?: never } | { resposta: Response; operador?: never }> {
  const operador = await obterOperador();
  if (!operador) {
    return { resposta: Response.json({ erro: "Não autenticado" }, { status: 401 }) };
  }
  if (!operador.pode(permissao)) {
    return { resposta: Response.json({ erro: "Sem permissão" }, { status: 403 }) };
  }
  return { operador };
}
