import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { Periodo } from "@/lib/painel/tempo";
import {
  permissoesEfetivas,
  PERMISSOES,
  type Permissao,
} from "@/lib/painel/permissoes";
import { serieTemporal, type Serie } from "@/lib/painel/metricas/base";

/**
 * Auditoria e administradores.
 *
 * Duas telas, uma pergunta em dois tempos: quem tem acesso, e o que fizeram
 * com ele. `AdminAudit` é a resposta do segundo tempo — nunca `Event`, que é
 * telemetria de produto, nem `AppLog`, que é o que o sistema fez sozinho.
 *
 * A trilha é append-only por decisão: nada aqui edita ou apaga uma linha de
 * auditoria. Uma trilha que o administrador pode corrigir não serve para
 * auditar administrador nenhum.
 */

export type ResumoDaAuditoria = {
  acoes: number;
  atores: number;
  destrutivas: number;
  criticas: number;
  ultimaAcao: Date | null;
  primeiraAcao: Date | null;
  serie: Serie;
  porSeveridade: { severidade: string; total: number }[];
  porAcao: { acao: string; total: number }[];
};

export const SEVERIDADES = ["INFO", "WARNING", "CRITICAL"] as const;

export async function resumoDaAuditoria(
  periodo: Periodo,
): Promise<ResumoDaAuditoria> {
  const janela = {
    createdAt: { gte: periodo.inicio, lt: periodo.fim },
  };

  const [totais, severidade, acoes, extremos, serie] = await Promise.all([
    db.$queryRaw<{ acoes: number; atores: number }[]>(Prisma.sql`
      SELECT count(*)::int AS acoes, count(DISTINCT "actorId")::int AS atores
      FROM "AdminAudit"
      WHERE "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
    `),
    db.adminAudit.groupBy({
      by: ["severity"],
      where: janela,
      _count: { _all: true },
    }),
    db.adminAudit.groupBy({
      by: ["action"],
      where: janela,
      _count: { _all: true },
      orderBy: { _count: { action: "desc" } },
      take: 8,
    }),
    db.$queryRaw<{ primeira: Date | null; ultima: Date | null }[]>(Prisma.sql`
      SELECT min("createdAt") AS primeira, max("createdAt") AS ultima
      FROM "AdminAudit"
    `),
    serieTemporal({ tabela: "AdminAudit", coluna: "createdAt", periodo }),
  ]);

  const porSeveridade = new Map(
    severidade.map((linha) => [linha.severity as string, linha._count._all]),
  );

  return {
    acoes: Number(totais[0]?.acoes ?? 0),
    atores: Number(totais[0]?.atores ?? 0),
    destrutivas: porSeveridade.get("WARNING") ?? 0,
    criticas: porSeveridade.get("CRITICAL") ?? 0,
    ultimaAcao: extremos[0]?.ultima ?? null,
    primeiraAcao: extremos[0]?.primeira ?? null,
    serie,
    porSeveridade: SEVERIDADES.map((severidade) => ({
      severidade,
      total: porSeveridade.get(severidade) ?? 0,
    })),
    porAcao: acoes.map((linha) => ({
      acao: linha.action,
      total: linha._count._all,
    })),
  };
}

export type LinhaDeAuditoria = {
  id: string;
  acao: string;
  ator: { id: string; nome: string; email: string };
  tipoDoAlvo: string;
  alvoId: string | null;
  alvoRotulo: string | null;
  severidade: string;
  antes: unknown;
  depois: unknown;
  contexto: unknown;
  ip: string | null;
  quando: Date;
};

export type FiltroDaAuditoria = {
  periodo: Periodo;
  termo?: string;
  acao?: string;
  severidade?: string;
  atorId?: string;
  alvoId?: string;
  pagina?: number;
  porPagina?: number;
};

export async function listarAuditoria(filtro: FiltroDaAuditoria): Promise<{
  linhas: LinhaDeAuditoria[];
  total: number;
  pagina: number;
  paginas: number;
  /** Verbos distintos no período, para montar o seletor sem inventar opções. */
  acoesDisponiveis: string[];
}> {
  const porPagina = Math.min(100, Math.max(10, filtro.porPagina ?? 25));
  const pagina = Math.max(1, filtro.pagina ?? 1);

  const onde: Prisma.AdminAuditWhereInput = {
    createdAt: { gte: filtro.periodo.inicio, lt: filtro.periodo.fim },
  };
  if (filtro.termo?.trim()) {
    const termo = filtro.termo.trim();
    onde.OR = [
      { actorEmail: { contains: termo, mode: "insensitive" } },
      { actorName: { contains: termo, mode: "insensitive" } },
      { targetLabel: { contains: termo, mode: "insensitive" } },
      { targetId: termo },
      { action: { contains: termo, mode: "insensitive" } },
    ];
  }
  if (filtro.acao) onde.action = filtro.acao;
  if (
    filtro.severidade &&
    (SEVERIDADES as readonly string[]).includes(filtro.severidade)
  ) {
    onde.severity = filtro.severidade as (typeof SEVERIDADES)[number];
  }
  if (filtro.atorId) onde.actorId = filtro.atorId;
  if (filtro.alvoId) onde.targetId = filtro.alvoId;

  const [total, linhas, verbos] = await Promise.all([
    db.adminAudit.count({ where: onde }),
    db.adminAudit.findMany({
      where: onde,
      orderBy: { createdAt: "desc" },
      skip: (pagina - 1) * porPagina,
      take: porPagina,
    }),
    db.adminAudit.groupBy({
      by: ["action"],
      where: {
        createdAt: { gte: filtro.periodo.inicio, lt: filtro.periodo.fim },
      },
      _count: { _all: true },
      orderBy: { action: "asc" },
    }),
  ]);

  return {
    linhas: linhas.map((linha) => ({
      id: linha.id,
      acao: linha.action,
      ator: {
        id: linha.actorId,
        nome: linha.actorName,
        email: linha.actorEmail,
      },
      tipoDoAlvo: linha.targetType,
      alvoId: linha.targetId,
      alvoRotulo: linha.targetLabel,
      severidade: linha.severity,
      antes: linha.before,
      depois: linha.after,
      contexto: linha.context,
      ip: linha.ip,
      quando: linha.createdAt,
    })),
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
    acoesDisponiveis: verbos.map((verbo) => verbo.action),
  };
}

// ----------------------------------------------------- administradores

export type LinhaDeAdministrador = {
  id: string;
  nome: string;
  email: string;
  handle: string;
  papel: "USER" | "EDITOR" | "ADMIN";
  status: string;
  /** O que foi gravado na coluna — vazio para ADMIN, que tem tudo por definição. */
  concedidas: Permissao[];
  /** O que a pessoa realmente alcança. */
  efetivas: Permissao[];
  /** Se as efetivas vêm do papel e não de uma concessão explícita. */
  herdadas: boolean;
  ultimoAcesso: Date | null;
  criadoEm: Date;
  acoesNoPeriodo: number;
  ultimaAcao: Date | null;
};

export async function listarAdministradores(
  periodo: Periodo,
): Promise<LinhaDeAdministrador[]> {
  const [equipe, atividade] = await Promise.all([
    db.user.findMany({
      where: { role: { in: ["ADMIN", "EDITOR"] } },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        handle: true,
        role: true,
        status: true,
        permissions: true,
        lastSeenAt: true,
        createdAt: true,
      },
    }),
    db.$queryRaw<{ id: string; total: number; ultima: Date }[]>(Prisma.sql`
      SELECT "actorId" AS id, count(*)::int AS total, max("createdAt") AS ultima
      FROM "AdminAudit"
      WHERE "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
      GROUP BY 1
    `),
  ]);

  const porAtor = new Map(atividade.map((linha) => [linha.id, linha]));

  return equipe.map((pessoa) => {
    const concedidas = pessoa.permissions.filter(
      (p): p is Permissao => p in PERMISSOES,
    );
    const efetivas = permissoesEfetivas(pessoa.role, pessoa.permissions);
    const atividadeDaPessoa = porAtor.get(pessoa.id);

    return {
      id: pessoa.id,
      nome: pessoa.name,
      email: pessoa.email,
      handle: pessoa.handle,
      papel: pessoa.role,
      status: pessoa.status,
      concedidas,
      efetivas,
      // ADMIN recebe tudo por definição e EDITOR sem concessão cai no perfil
      // editorial: nos dois casos o acesso vem do papel, não de uma escolha
      // que alguém fez — e a tela precisa dizer isso.
      herdadas: pessoa.role === "ADMIN" || concedidas.length === 0,
      ultimoAcesso: pessoa.lastSeenAt,
      criadoEm: pessoa.createdAt,
      acoesNoPeriodo: Number(atividadeDaPessoa?.total ?? 0),
      ultimaAcao: atividadeDaPessoa?.ultima ?? null,
    };
  });
}

export async function administrador(id: string) {
  const pessoa = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      handle: true,
      role: true,
      status: true,
      permissions: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });
  if (!pessoa) return null;
  if (pessoa.role !== "ADMIN" && pessoa.role !== "EDITOR") return null;

  const concedidas = pessoa.permissions.filter(
    (p): p is Permissao => p in PERMISSOES,
  );

  return {
    ...pessoa,
    concedidas,
    efetivas: permissoesEfetivas(pessoa.role, pessoa.permissions),
    herdadas: pessoa.role === "ADMIN" || concedidas.length === 0,
  };
}

/** Quantos ADMIN ativos existem — usado para impedir a última porta se fechar. */
export async function contarAdminsAtivos(): Promise<number> {
  return db.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
}

/** Contas fora da equipe, para conceder acesso a alguém que já usa o produto. */
export async function candidatosAAdmin(termo: string) {
  const alvo = termo.trim();
  if (alvo.length < 2) return [];
  return db.user.findMany({
    where: {
      role: "USER",
      status: { not: "DELETED" },
      OR: [
        { email: { contains: alvo, mode: "insensitive" } },
        { name: { contains: alvo, mode: "insensitive" } },
        { handle: { contains: alvo, mode: "insensitive" } },
      ],
    },
    take: 8,
    select: { id: true, name: true, email: true, handle: true, isDemo: true },
  });
}
