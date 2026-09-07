import "server-only";

import { headers } from "next/headers";

import { db } from "@/lib/db";
import type { Operador } from "@/lib/painel/guarda";
import type { AuditSeverity, Prisma } from "@prisma/client";

/**
 * Registro de ações administrativas.
 *
 * Uma ação sem registro não aconteceu — do ponto de vista de quem precisa
 * reconstruir o que houve depois. Por isso `registrar` guarda o estado antes e
 * depois, e não apenas o verbo: saber que alguém "editou a novela" não ajuda;
 * saber que trocou o status de RASCUNHO para PUBLICADO às 14h32, ajuda.
 *
 * Diferente de `Event` (telemetria de produto) e de `AppLog` (o que o sistema
 * fez). Aqui é sempre uma pessoa, sempre com nome.
 */

export type AcaoAuditada = {
  /** Verbo pontuado, hierárquico: "catalogo.novela.publicar". */
  action: string;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  before?: unknown;
  after?: unknown;
  severity?: AuditSeverity;
  context?: Prisma.InputJsonValue;
};

function limpar(valor: unknown): Prisma.InputJsonValue | undefined {
  if (valor === undefined || valor === null) return undefined;
  // BigInt e Date não sobrevivem a JSON.stringify direto.
  return JSON.parse(
    JSON.stringify(valor, (_chave, v) =>
      typeof v === "bigint" ? Number(v) : v,
    ),
  ) as Prisma.InputJsonValue;
}

export async function registrarAuditoria(
  operador: Pick<Operador, "id" | "email" | "nome">,
  acao: AcaoAuditada,
): Promise<void> {
  try {
    const cabecalhos = await headers();
    await db.adminAudit.create({
      data: {
        actorId: operador.id,
        actorEmail: operador.email,
        actorName: operador.nome,
        action: acao.action,
        targetType: acao.targetType,
        targetId: acao.targetId ?? null,
        targetLabel: acao.targetLabel ?? null,
        before: limpar(acao.before),
        after: limpar(acao.after),
        severity: acao.severity ?? "INFO",
        ip:
          cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          cabecalhos.get("x-real-ip") ??
          null,
        userAgent: cabecalhos.get("user-agent")?.slice(0, 400) ?? null,
        context: acao.context ?? {},
      },
    });
  } catch (erro) {
    // Auditoria quebrada não pode derrubar a ação que estava sendo auditada,
    // mas precisa gritar: uma ação sem trilha é exatamente o que não queremos.
    console.error("[auditoria] falha ao registrar", acao.action, erro);
  }
}

/**
 * Diferença entre dois estados, só nos campos que mudaram. Guardar o objeto
 * inteiro transformaria a tela de auditoria em um paredão de JSON igual.
 */
export function diferenca<T extends Record<string, unknown>>(
  antes: T,
  depois: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const before: Partial<T> = {};
  const after: Partial<T> = {};
  let mudou = false;

  for (const chave of Object.keys(depois) as (keyof T)[]) {
    const a = antes[chave];
    const b = depois[chave];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    before[chave] = a;
    after[chave] = b;
    mudou = true;
  }

  return mudou ? { before, after } : null;
}
