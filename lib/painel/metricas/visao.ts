import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { indicador, type Indicador } from "@/lib/painel/numeros";
import { calcularMrr } from "@/lib/painel/planos";
import type { Periodo } from "@/lib/painel/tempo";
import {
  agoraMenos,
  CONTAR,
  eventosDoTipo,
  JANELA_AGORA_MS,
  serieTemporal,
  SOMAR_MS,
  totalNoPeriodo,
  PESSOAS_DISTINTAS,
  type Serie,
} from "@/lib/painel/metricas/base";

/**
 * Visão geral — o centro nervoso.
 *
 * Cada número aqui existe porque responde a uma das perguntas que a operação
 * faz ao abrir o painel. Nenhum vem de contador semeado; todos vêm de fatos
 * datados, e os que ainda não têm histórico dizem desde quando são medidos em
 * vez de fingir uma série completa.
 */

export type AgoraMesmo = {
  /** Pessoas com sessão batendo nos últimos 5 minutos. */
  online: number;
  /** Dessas, quantas estão com vídeo rodando. */
  assistindo: number;
  sessoesAbertas: number;
  /** Quantas dessas sessões estão instaladas como aplicativo. */
  instaladas: number;
};

export type CoberturaDaMetrica = {
  /** Desde quando existe registro. `null` = nenhum fato ainda. */
  desde: Date | null;
  /** Verdadeiro quando o período pedido começa antes do primeiro registro. */
  parcial: boolean;
};

export type ResumoDaVisao = {
  agora: AgoraMesmo;

  novosUsuarios: Indicador;
  novosAssinantes: Indicador;
  cancelamentos: Indicador;
  sessoes: Indicador;
  espectadores: Indicador;
  reproducoes: Indicador;
  tempoAssistidoMs: Indicador;
  tempoNaPlataformaMs: Indicador;
  receitaCents: Indicador;
  falhas: Indicador;

  assinantesAtivos: number;
  usuariosTotais: number;
  mrr: ReturnType<typeof calcularMrr>;
  churn: { taxa: number | null; cancelados: number; baseInicial: number };

  coberturaTempoAssistido: CoberturaDaMetrica;
  coberturaReceita: CoberturaDaMetrica;

  series: {
    sessoes: Serie;
    sessoesAnterior: Serie;
    reproducoes: Serie;
    reproducoesAnterior: Serie;
    tempoAssistidoMs: Serie;
    novosUsuarios: Serie;
    espectadores: Serie;
  };
};

/** Estado do minuto. Não tem período: "agora" é sempre agora. */
export async function agoraMesmo(): Promise<AgoraMesmo> {
  const limite = agoraMenos(JANELA_AGORA_MS);

  const [sessoes, assistindo] = await Promise.all([
    db.appSession.findMany({
      where: { lastBeatAt: { gte: limite }, endedAt: null },
      select: { userId: true, deviceId: true, standalone: true },
    }),
    db.event.findMany({
      where: { type: "PLAY_PROGRESS", createdAt: { gte: limite } },
      select: { userId: true, deviceId: true },
      distinct: ["userId", "deviceId"],
    }),
  ]);

  // Quem entrou conta pela conta; quem ainda não entrou conta pelo aparelho.
  // Duas abas do mesmo aparelho são uma pessoa, não duas.
  const pessoas = new Set(sessoes.map((s) => s.userId ?? `dispositivo:${s.deviceId}`));

  return {
    online: pessoas.size,
    assistindo: assistindo.length,
    sessoesAbertas: sessoes.length,
    instaladas: sessoes.filter((s) => s.standalone).length,
  };
}

async function cobertura(
  tabela: "Event" | "Payment",
  periodo: Periodo,
  filtro?: Prisma.Sql,
): Promise<CoberturaDaMetrica> {
  const linhas = await db.$queryRaw<{ primeiro: Date | null }[]>(Prisma.sql`
    SELECT min("createdAt") AS primeiro
    FROM ${Prisma.raw(`"${tabela}"`)}
    ${filtro ? Prisma.sql`WHERE ${filtro}` : Prisma.empty}
  `);
  const desde = linhas[0]?.primeiro ?? null;
  return { desde, parcial: desde !== null && desde > periodo.inicio };
}

export async function resumoDaVisao(periodo: Periodo): Promise<ResumoDaVisao> {
  const [
    agora,
    novosUsuarios,
    novosAssinantes,
    cancelamentos,
    sessoes,
    espectadores,
    reproducoes,
    tempoAssistido,
    tempoNaPlataforma,
    receita,
    falhas,
    assinaturasAtivas,
    usuariosTotais,
    baseInicial,
    coberturaTempoAssistido,
    coberturaReceita,
    serieSessoes,
    serieSessoesAnterior,
    serieReproducoes,
    serieReproducoesAnterior,
    serieTempoAssistido,
    serieNovosUsuarios,
    serieEspectadores,
  ] = await Promise.all([
    agoraMesmo(),

    totalNoPeriodo({ tabela: "User", coluna: "createdAt", periodo }),

    totalNoPeriodo({ tabela: "Subscription", coluna: "startedAt", periodo,
      filtro: Prisma.sql`"plan"::text <> 'FREE'` }),

    totalNoPeriodo({ tabela: "Subscription", coluna: "canceledAt", periodo }),

    totalNoPeriodo({ tabela: "AppSession", coluna: "startedAt", periodo }),

    totalNoPeriodo({ tabela: "AppSession", coluna: "startedAt", periodo,
      expressao: PESSOAS_DISTINTAS }),

    totalNoPeriodo({ tabela: "Event", coluna: "createdAt", periodo,
      filtro: eventosDoTipo("PLAY_START") }),

    totalNoPeriodo({ tabela: "Event", coluna: "createdAt", periodo,
      expressao: SOMAR_MS, filtro: eventosDoTipo("PLAY_PROGRESS") }),

    totalNoPeriodo({ tabela: "AppSession", coluna: "startedAt", periodo,
      expressao: Prisma.sql`coalesce(sum("durationMs"), 0)::float8` }),

    totalNoPeriodo({ tabela: "Payment", coluna: "createdAt", periodo,
      expressao: Prisma.sql`coalesce(sum("amountCents" - "refundedCents"), 0)::float8`,
      filtro: Prisma.sql`"status"::text = 'APPROVED'` }),

    totalNoPeriodo({ tabela: "AppLog", coluna: "createdAt", periodo,
      filtro: Prisma.sql`"level"::text IN ('ERROR', 'FATAL')` }),

    db.subscription.findMany({
      where: {
        plan: { not: "FREE" },
        status: { in: ["ACTIVE", "TRIALING"] },
        OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: new Date() } }],
      },
      select: { plan: true, priceCents: true },
    }),

    db.user.count({ where: { status: { not: "DELETED" } } }),

    // Base do churn: quem já era assinante quando o período começou.
    db.subscription.count({
      where: {
        plan: { not: "FREE" },
        startedAt: { lt: periodo.inicio },
        OR: [{ canceledAt: null }, { canceledAt: { gte: periodo.inicio } }],
      },
    }),

    cobertura("Event", periodo, Prisma.sql`"type"::text = 'PLAY_PROGRESS'`),
    cobertura("Payment", periodo),

    serieTemporal({ tabela: "AppSession", coluna: "startedAt", periodo }),
    serieTemporal({ tabela: "AppSession", coluna: "startedAt", periodo, anterior: true }),

    serieTemporal({ tabela: "Event", coluna: "createdAt", periodo,
      filtro: eventosDoTipo("PLAY_START") }),
    serieTemporal({ tabela: "Event", coluna: "createdAt", periodo, anterior: true,
      filtro: eventosDoTipo("PLAY_START") }),

    serieTemporal({ tabela: "Event", coluna: "createdAt", periodo,
      expressao: SOMAR_MS, filtro: eventosDoTipo("PLAY_PROGRESS") }),

    serieTemporal({ tabela: "User", coluna: "createdAt", periodo }),

    serieTemporal({ tabela: "AppSession", coluna: "startedAt", periodo,
      expressao: PESSOAS_DISTINTAS }),
  ]);

  const mrr = calcularMrr(assinaturasAtivas);

  return {
    agora,

    novosUsuarios: indicador(novosUsuarios.atual, novosUsuarios.anterior),
    novosAssinantes: indicador(novosAssinantes.atual, novosAssinantes.anterior),
    cancelamentos: indicador(cancelamentos.atual, cancelamentos.anterior),
    sessoes: indicador(sessoes.atual, sessoes.anterior),
    espectadores: indicador(espectadores.atual, espectadores.anterior),
    reproducoes: indicador(reproducoes.atual, reproducoes.anterior),
    tempoAssistidoMs: indicador(tempoAssistido.atual, tempoAssistido.anterior),
    tempoNaPlataformaMs: indicador(tempoNaPlataforma.atual, tempoNaPlataforma.anterior),
    receitaCents: indicador(receita.atual, receita.anterior),
    falhas: indicador(falhas.atual, falhas.anterior),

    assinantesAtivos: assinaturasAtivas.length,
    usuariosTotais,
    mrr,
    churn: {
      // Sem base, não há taxa — e `0 de 0` não é "0% de churn".
      taxa: baseInicial > 0 ? cancelamentos.atual / baseInicial : null,
      cancelados: cancelamentos.atual,
      baseInicial,
    },

    coberturaTempoAssistido,
    coberturaReceita,

    series: {
      sessoes: serieSessoes,
      sessoesAnterior: serieSessoesAnterior,
      reproducoes: serieReproducoes,
      reproducoesAnterior: serieReproducoesAnterior,
      tempoAssistidoMs: serieTempoAssistido,
      novosUsuarios: serieNovosUsuarios,
      espectadores: serieEspectadores,
    },
  };
}

// ------------------------------------------------------------- conteúdo

export type LinhaDeConteudo = {
  novelaId: string;
  slug: string;
  titulo: string;
  accent: string;
  posterKey: string;
  reproducoes: number;
  espectadores: number;
  tempoAssistidoMs: number;
  conclusoes: number;
};

/**
 * Conteúdo mais assistido no período — derivado de eventos, não de
 * `Novela.viewCount`.
 */
export async function conteudoMaisAssistido(
  periodo: Periodo,
  limite = 8,
): Promise<LinhaDeConteudo[]> {
  return db.$queryRaw<LinhaDeConteudo[]>(Prisma.sql`
    SELECT
      n."id"        AS "novelaId",
      n."slug"      AS "slug",
      n."title"     AS "titulo",
      n."accent"    AS "accent",
      n."posterKey" AS "posterKey",
      count(*) FILTER (WHERE e."type"::text = 'PLAY_START')::int      AS "reproducoes",
      count(DISTINCT e."userId")::int                                  AS "espectadores",
      coalesce(sum(e."valueMs") FILTER (
        WHERE e."type"::text = 'PLAY_PROGRESS'), 0)::float8            AS "tempoAssistidoMs",
      count(*) FILTER (WHERE e."type"::text = 'PLAY_COMPLETE')::int    AS "conclusoes"
    FROM "Event" e
    JOIN "Novela" n ON n."id" = e."novelaId"
    WHERE e."createdAt" >= ${periodo.inicio}
      AND e."createdAt" <  ${periodo.fim}
      AND e."type"::text IN ('PLAY_START', 'PLAY_PROGRESS', 'PLAY_COMPLETE')
    GROUP BY n."id", n."slug", n."title", n."accent", n."posterKey"
    ORDER BY "reproducoes" DESC, "tempoAssistidoMs" DESC
    LIMIT ${limite}
  `);
}

/**
 * Novelas que mais cresceram (ou caíram) em reproduções contra a janela
 * anterior. Crescimento é o que dá pauta editorial; o total já está na tabela
 * de mais assistidos.
 */
export type LinhaDeCrescimento = LinhaDeConteudo & {
  anterior: number;
  variacao: number | null;
};

export async function crescimentoDeConteudo(
  periodo: Periodo,
  limite = 6,
): Promise<LinhaDeCrescimento[]> {
  const linhas = await db.$queryRaw<
    (LinhaDeConteudo & { anterior: number })[]
  >(Prisma.sql`
    WITH atual AS (
      SELECT "novelaId", count(*)::int AS n
      FROM "Event"
      WHERE "type"::text = 'PLAY_START'
        AND "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
        AND "novelaId" IS NOT NULL
      GROUP BY 1
    ),
    passado AS (
      SELECT "novelaId", count(*)::int AS n
      FROM "Event"
      WHERE "type"::text = 'PLAY_START'
        AND "createdAt" >= ${periodo.anterior.inicio} AND "createdAt" < ${periodo.anterior.fim}
        AND "novelaId" IS NOT NULL
      GROUP BY 1
    )
    SELECT
      n."id" AS "novelaId", n."slug", n."title" AS "titulo", n."accent",
      n."posterKey" AS "posterKey",
      coalesce(a.n, 0) AS "reproducoes",
      0 AS "espectadores",
      0::float8 AS "tempoAssistidoMs",
      0 AS "conclusoes",
      coalesce(p.n, 0) AS "anterior"
    FROM "Novela" n
    LEFT JOIN atual a   ON a."novelaId" = n."id"
    LEFT JOIN passado p ON p."novelaId" = n."id"
    WHERE coalesce(a.n, 0) > 0 OR coalesce(p.n, 0) > 0
  `);

  return linhas
    .map((linha) => ({
      ...linha,
      variacao:
        linha.anterior === 0
          ? null
          : (linha.reproducoes - linha.anterior) / linha.anterior,
    }))
    .sort((a, b) => {
      const pa = a.reproducoes - a.anterior;
      const pb = b.reproducoes - b.anterior;
      return Math.abs(pb) - Math.abs(pa);
    })
    .slice(0, limite);
}
