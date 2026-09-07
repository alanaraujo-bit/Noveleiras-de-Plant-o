import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { Periodo } from "@/lib/painel/tempo";
import { serieTemporal, type Serie } from "@/lib/painel/metricas/base";

/**
 * Central de logs.
 *
 * `AppLog` é o que o **sistema** fez — uma cobrança que falhou, uma mídia que
 * não abriu, um job que morreu. Separado de `Event` (o que a pessoa fez) e de
 * `AdminAudit` (o que um administrador fez) porque investigar um incidente
 * peneirando meio milhão de `SCREEN_VIEW` é o que ninguém quer.
 *
 * `correlationId` costura a investigação: a mesma reprodução que falhou
 * aparece em STREAMING, MEDIA e SERVER com a mesma chave, e a tela consegue
 * remontar a história inteira a partir de qualquer uma das linhas.
 */

export const NIVEIS = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const;
export const CANAIS = [
  "APP",
  "SERVER",
  "STREAMING",
  "MEDIA",
  "AUTH",
  "PAYMENTS",
  "JOBS",
  "INTEGRATIONS",
  "ADMIN",
] as const;

export type ResumoDeLogs = {
  total: number;
  problemas: number;
  fatais: number;
  correlacoes: number;
  primeiro: Date | null;
  ultimo: Date | null;
  serie: Serie;
  serieProblemas: Serie;
  porNivel: { nivel: string; total: number }[];
  porCanal: { canal: string; total: number }[];
  /** Mensagens que mais se repetem — ruído recorrente é sintoma. */
  recorrentes: { mensagem: string; total: number; nivel: string }[];
};

export async function resumoDeLogs(periodo: Periodo): Promise<ResumoDeLogs> {
  const janela = { createdAt: { gte: periodo.inicio, lt: periodo.fim } };

  const [totais, porNivel, porCanal, recorrentes, extremos, serie, serieProblemas] =
    await Promise.all([
      db.$queryRaw<{ total: number; correlacoes: number }[]>(Prisma.sql`
        SELECT count(*)::int AS total,
               count(DISTINCT "correlationId")::int AS correlacoes
        FROM "AppLog"
        WHERE "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
      `),
      db.appLog.groupBy({
        by: ["level"],
        where: janela,
        _count: { _all: true },
      }),
      db.appLog.groupBy({
        by: ["channel"],
        where: janela,
        _count: { _all: true },
        orderBy: { _count: { channel: "desc" } },
      }),
      db.$queryRaw<{ mensagem: string; total: number; nivel: string }[]>(Prisma.sql`
        SELECT "message" AS mensagem, count(*)::int AS total,
               (array_agg("level"::text ORDER BY "createdAt" DESC))[1] AS nivel
        FROM "AppLog"
        WHERE "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
        GROUP BY 1
        HAVING count(*) > 1
        ORDER BY total DESC
        LIMIT 8
      `),
      db.$queryRaw<{ primeiro: Date | null; ultimo: Date | null }[]>(Prisma.sql`
        SELECT min("createdAt") AS primeiro, max("createdAt") AS ultimo FROM "AppLog"
      `),
      serieTemporal({ tabela: "AppLog", coluna: "createdAt", periodo }),
      serieTemporal({
        tabela: "AppLog",
        coluna: "createdAt",
        periodo,
        filtro: Prisma.sql`"level"::text IN ('ERROR', 'FATAL')`,
      }),
    ]);

  const niveis = new Map(
    porNivel.map((linha) => [linha.level as string, linha._count._all]),
  );

  return {
    total: Number(totais[0]?.total ?? 0),
    problemas: (niveis.get("ERROR") ?? 0) + (niveis.get("FATAL") ?? 0),
    fatais: niveis.get("FATAL") ?? 0,
    correlacoes: Number(totais[0]?.correlacoes ?? 0),
    primeiro: extremos[0]?.primeiro ?? null,
    ultimo: extremos[0]?.ultimo ?? null,
    serie,
    serieProblemas,
    porNivel: NIVEIS.map((nivel) => ({
      nivel,
      total: niveis.get(nivel) ?? 0,
    })),
    porCanal: porCanal.map((linha) => ({
      canal: linha.channel,
      total: linha._count._all,
    })),
    recorrentes: recorrentes.map((linha) => ({
      mensagem: linha.mensagem,
      total: Number(linha.total),
      nivel: linha.nivel,
    })),
  };
}

export type LinhaDeLog = {
  id: string;
  nivel: string;
  canal: string;
  mensagem: string;
  correlacao: string | null;
  usuarioId: string | null;
  entidade: string | null;
  caminho: string | null;
  pilha: string | null;
  contexto: unknown;
  quando: Date;
};

export type FiltroDeLogs = {
  periodo: Periodo;
  termo?: string;
  nivel?: string;
  canal?: string;
  correlacao?: string;
  /** Atalho para ERROR e FATAL juntos — o que a operação abre primeiro. */
  apenasProblemas?: boolean;
  pagina?: number;
  porPagina?: number;
};

export async function listarLogs(filtro: FiltroDeLogs): Promise<{
  linhas: LinhaDeLog[];
  total: number;
  pagina: number;
  paginas: number;
}> {
  const porPagina = Math.min(200, Math.max(10, filtro.porPagina ?? 50));
  const pagina = Math.max(1, filtro.pagina ?? 1);

  const onde: Prisma.AppLogWhereInput = {
    createdAt: { gte: filtro.periodo.inicio, lt: filtro.periodo.fim },
  };
  if (filtro.termo?.trim()) {
    const termo = filtro.termo.trim();
    onde.OR = [
      { message: { contains: termo, mode: "insensitive" } },
      { correlationId: termo },
      { entityId: termo },
      { path: { contains: termo, mode: "insensitive" } },
    ];
  }
  if (filtro.nivel && (NIVEIS as readonly string[]).includes(filtro.nivel)) {
    onde.level = filtro.nivel as (typeof NIVEIS)[number];
  }
  if (filtro.canal && (CANAIS as readonly string[]).includes(filtro.canal)) {
    onde.channel = filtro.canal as (typeof CANAIS)[number];
  }
  // Uma correlação é uma investigação inteira: quando ela é o filtro, o
  // período sai da frente — a história pode ter começado antes do recorte.
  if (filtro.correlacao) {
    onde.correlationId = filtro.correlacao;
    delete onde.createdAt;
  }
  if (filtro.apenasProblemas) {
    onde.level = { in: ["ERROR", "FATAL"] };
  }

  const [total, linhas] = await Promise.all([
    db.appLog.count({ where: onde }),
    db.appLog.findMany({
      where: onde,
      orderBy: { createdAt: filtro.correlacao ? "asc" : "desc" },
      skip: (pagina - 1) * porPagina,
      take: porPagina,
    }),
  ]);

  return {
    linhas: linhas.map((linha) => ({
      id: linha.id,
      nivel: linha.level,
      canal: linha.channel,
      mensagem: linha.message,
      correlacao: linha.correlationId,
      usuarioId: linha.userId,
      entidade: linha.entityType
        ? `${linha.entityType}${linha.entityId ? ` ${linha.entityId}` : ""}`
        : null,
      caminho: linha.path,
      pilha: linha.stack,
      contexto: linha.context,
      quando: linha.createdAt,
    })),
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
  };
}
