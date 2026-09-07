import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { indicador, type Indicador } from "@/lib/painel/numeros";
import {
  eventosDoTipo,
  PESSOAS_DISTINTAS,
  serieTemporal,
  SOMAR_MS,
  totalNoPeriodo,
  type Serie,
} from "@/lib/painel/metricas/base";
import { FUSO, noFuso, type Periodo } from "@/lib/painel/tempo";

/**
 * Comportamento de quem usa a plataforma.
 *
 * A pergunta que organiza este módulo não é "quantos usuários temos" — é
 * "quem volta, com que frequência, por quanto tempo, e quem parou de voltar".
 * Contagem de cadastro é vaidade; recorrência é o negócio.
 */

// ---------------------------------------------------------------- resumo

export type ResumoDeUsuarios = {
  dau: number;
  wau: number;
  mau: number;
  /** Proporção DAU/MAU: quão "diário" é o produto. */
  aderencia: number | null;

  novos: Indicador;
  recorrentes: Indicador;
  ativos: Indicador;
  duracaoMediaSessaoMs: Indicador;
  sessoesPorPessoa: Indicador;
  tempoNaPlataformaMs: Indicador;
  tempoAssistidoMs: Indicador;

  inativos30d: number;
  totalContas: number;
  contasDemo: number;

  series: {
    ativos: Serie;
    novos: Serie;
    duracaoMediaMs: Serie;
  };
};

async function ativosEm(dias: number): Promise<number> {
  const desde = new Date(Date.now() - dias * 86_400_000);
  const linhas = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT count(DISTINCT coalesce("userId", "deviceId"))::int AS n
    FROM "AppSession"
    WHERE "startedAt" >= ${desde}
  `);
  return linhas[0]?.n ?? 0;
}

export async function resumoDeUsuarios(
  periodo: Periodo,
): Promise<ResumoDeUsuarios> {
  const [
    dau,
    wau,
    mau,
    novos,
    ativos,
    duracaoMedia,
    tempoNaPlataforma,
    tempoAssistido,
    sessoes,
    inativos30d,
    totalContas,
    contasDemo,
    serieAtivos,
    serieNovos,
    serieDuracao,
  ] = await Promise.all([
    ativosEm(1),
    ativosEm(7),
    ativosEm(30),

    totalNoPeriodo({ tabela: "User", coluna: "createdAt", periodo }),

    totalNoPeriodo({
      tabela: "AppSession",
      coluna: "startedAt",
      periodo,
      expressao: PESSOAS_DISTINTAS,
    }),

    totalNoPeriodo({
      tabela: "AppSession",
      coluna: "startedAt",
      periodo,
      // Sessão de duração zero é ruído de abertura, não visita: distorceria a
      // média para baixo sem dizer nada sobre o comportamento de ninguém.
      expressao: Prisma.sql`coalesce(avg(NULLIF("durationMs", 0)), 0)::float8`,
    }),

    totalNoPeriodo({
      tabela: "AppSession",
      coluna: "startedAt",
      periodo,
      expressao: Prisma.sql`coalesce(sum("durationMs"), 0)::float8`,
    }),

    totalNoPeriodo({
      tabela: "Event",
      coluna: "createdAt",
      periodo,
      expressao: SOMAR_MS,
      filtro: eventosDoTipo("PLAY_PROGRESS"),
    }),

    totalNoPeriodo({ tabela: "AppSession", coluna: "startedAt", periodo }),

    db.user.count({
      where: {
        status: "ACTIVE",
        OR: [
          { lastSeenAt: null },
          { lastSeenAt: { lt: new Date(Date.now() - 30 * 86_400_000) } },
        ],
      },
    }),

    db.user.count({ where: { status: { not: "DELETED" } } }),
    db.user.count({ where: { isDemo: true } }),

    serieTemporal({
      tabela: "AppSession",
      coluna: "startedAt",
      periodo,
      expressao: PESSOAS_DISTINTAS,
    }),
    serieTemporal({ tabela: "User", coluna: "createdAt", periodo }),
    serieTemporal({
      tabela: "AppSession",
      coluna: "startedAt",
      periodo,
      expressao: Prisma.sql`coalesce(avg(NULLIF("durationMs", 0)), 0)::float8`,
    }),
  ]);

  const recorrentesAtual = Math.max(0, ativos.atual - novos.atual);
  const recorrentesAnterior = Math.max(0, ativos.anterior - novos.anterior);

  return {
    dau,
    wau,
    mau,
    aderencia: mau > 0 ? dau / mau : null,

    novos: indicador(novos.atual, novos.anterior),
    recorrentes: indicador(recorrentesAtual, recorrentesAnterior),
    ativos: indicador(ativos.atual, ativos.anterior),
    duracaoMediaSessaoMs: indicador(duracaoMedia.atual, duracaoMedia.anterior),
    sessoesPorPessoa: indicador(
      ativos.atual > 0 ? sessoes.atual / ativos.atual : 0,
      ativos.anterior > 0 ? sessoes.anterior / ativos.anterior : 0,
    ),
    tempoNaPlataformaMs: indicador(
      tempoNaPlataforma.atual,
      tempoNaPlataforma.anterior,
    ),
    tempoAssistidoMs: indicador(tempoAssistido.atual, tempoAssistido.anterior),

    inativos30d,
    totalContas,
    contasDemo,

    series: {
      ativos: serieAtivos,
      novos: serieNovos,
      duracaoMediaMs: serieDuracao,
    },
  };
}

// ------------------------------------------------------- horários de pico

/**
 * Mapa dia da semana × hora, no fuso da operação.
 *
 * Responde "quando faz sentido lançar episódio" melhor que qualquer média:
 * a média esconde que domingo à noite não se parece com terça de manhã.
 */
export async function mapaDeHorarios(periodo: Periodo): Promise<number[][]> {
  const linhas = await db.$queryRaw<
    { dia: number; hora: number; n: number }[]
  >(Prisma.sql`
    SELECT
      EXTRACT(DOW  FROM ${Prisma.raw(noFuso("startedAt"))})::int AS dia,
      EXTRACT(HOUR FROM ${Prisma.raw(noFuso("startedAt"))})::int AS hora,
      count(*)::int AS n
    FROM "AppSession"
    WHERE "startedAt" >= ${periodo.inicio} AND "startedAt" < ${periodo.fim}
    GROUP BY 1, 2
  `);

  const grade: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0),
  );
  for (const linha of linhas) {
    if (grade[linha.dia]) grade[linha.dia][linha.hora] = linha.n;
  }
  return grade;
}

// ------------------------------------------------------------ dispositivos

export type LinhaDeDispositivo = {
  osName: string | null;
  browser: string | null;
  platform: string;
  sessoes: number;
  pessoas: number;
  tempoMs: number;
};

export async function dispositivos(
  periodo: Periodo,
): Promise<LinhaDeDispositivo[]> {
  return db.$queryRaw<LinhaDeDispositivo[]>(Prisma.sql`
    SELECT
      "osName", "browser", "platform",
      count(*)::int AS sessoes,
      count(DISTINCT coalesce("userId", "deviceId"))::int AS pessoas,
      coalesce(sum("durationMs"), 0)::float8 AS "tempoMs"
    FROM "AppSession"
    WHERE "startedAt" >= ${periodo.inicio} AND "startedAt" < ${periodo.fim}
    GROUP BY 1, 2, 3
    ORDER BY sessoes DESC
  `);
}

// ----------------------------------------------------------------- coortes

export type Coorte = {
  /** Semana de cadastro, no fuso da operação. */
  semana: string;
  tamanho: number;
  /** Retorno por semana desde o cadastro: [semana 0, 1, 2, ...]. */
  retorno: number[];
};

/**
 * Retenção por coorte de cadastro.
 *
 * Semana, e não dia: com o volume atual, coorte diária vira uma tabela de
 * uns e zeros que não sustenta conclusão nenhuma.
 */
export async function coortesDeRetencao(semanas = 8): Promise<Coorte[]> {
  const linhas = await db.$queryRaw<
    { semana: Date; deslocamento: number; pessoas: number; tamanho: number }[]
  >(Prisma.sql`
    WITH coorte AS (
      SELECT
        "id" AS user_id,
        date_trunc('week', ${Prisma.raw(noFuso("createdAt"))}) AS semana
      FROM "User"
      WHERE "createdAt" >= now() - (${semanas} * interval '1 week')
    ),
    tamanhos AS (
      SELECT semana, count(*)::int AS tamanho FROM coorte GROUP BY 1
    ),
    atividade AS (
      SELECT DISTINCT
        c.semana,
        c.user_id,
        (EXTRACT(EPOCH FROM (
          date_trunc('week', (s."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${FUSO}))
          - c.semana
        )) / 604800)::int AS deslocamento
      FROM coorte c
      JOIN "AppSession" s ON s."userId" = c.user_id
    )
    SELECT
      a.semana,
      a.deslocamento,
      count(*)::int AS pessoas,
      t.tamanho
    FROM atividade a
    JOIN tamanhos t ON t.semana = a.semana
    WHERE a.deslocamento >= 0
    GROUP BY a.semana, a.deslocamento, t.tamanho
    ORDER BY a.semana DESC, a.deslocamento
  `);

  const porSemana = new Map<string, Coorte>();
  for (const linha of linhas) {
    const chave = linha.semana.toISOString().slice(0, 10);
    if (!porSemana.has(chave)) {
      porSemana.set(chave, {
        semana: chave,
        tamanho: linha.tamanho,
        retorno: [],
      });
    }
    const coorte = porSemana.get(chave)!;
    coorte.retorno[linha.deslocamento] = linha.pessoas;
  }

  for (const coorte of porSemana.values()) {
    for (let i = 0; i < coorte.retorno.length; i += 1) {
      coorte.retorno[i] ??= 0;
    }
  }

  return [...porSemana.values()];
}

// ------------------------------------------------------------- listagem

export type FiltroDeUsuarios = {
  termo?: string;
  plano?: string;
  status?: string;
  atividade?: "ativos7d" | "ativos30d" | "inativos30d" | "nunca";
  ordem?: "recentes" | "ativos" | "assistido" | "nome";
  pagina?: number;
  porPagina?: number;
  incluirDemo?: boolean;
};

export type LinhaDeUsuario = {
  id: string;
  nome: string;
  email: string;
  handle: string;
  avatarSeed: string;
  papel: string;
  status: string;
  isDemo: boolean;
  criadoEm: Date;
  ultimoAcesso: Date | null;
  plano: string | null;
  statusAssinatura: string | null;
  sessoes: number;
  tempoNaPlataformaMs: number;
  tempoAssistidoMs: number;
  episodiosIniciados: number;
  episodiosConcluidos: number;
};

export async function listarUsuarios(filtro: FiltroDeUsuarios): Promise<{
  linhas: LinhaDeUsuario[];
  total: number;
  pagina: number;
  paginas: number;
}> {
  const porPagina = Math.min(100, Math.max(10, filtro.porPagina ?? 25));
  const pagina = Math.max(1, filtro.pagina ?? 1);

  const condicoes: Prisma.Sql[] = [Prisma.sql`u."status" <> 'DELETED'`];

  if (filtro.termo?.trim()) {
    const alvo = `%${filtro.termo.trim().toLowerCase()}%`;
    condicoes.push(Prisma.sql`(
      lower(u."name") LIKE ${alvo}
      OR lower(u."email") LIKE ${alvo}
      OR lower(u."handle") LIKE ${alvo}
      OR u."id" = ${filtro.termo.trim()}
    )`);
  }
  if (filtro.plano) {
    condicoes.push(Prisma.sql`s."plan"::text = ${filtro.plano}`);
  }
  if (filtro.status) {
    condicoes.push(Prisma.sql`u."status"::text = ${filtro.status}`);
  }
  if (!filtro.incluirDemo) {
    condicoes.push(Prisma.sql`u."isDemo" = false`);
  }
  if (filtro.atividade === "ativos7d") {
    condicoes.push(Prisma.sql`u."lastSeenAt" >= now() - interval '7 days'`);
  } else if (filtro.atividade === "ativos30d") {
    condicoes.push(Prisma.sql`u."lastSeenAt" >= now() - interval '30 days'`);
  } else if (filtro.atividade === "inativos30d") {
    condicoes.push(
      Prisma.sql`(u."lastSeenAt" IS NULL OR u."lastSeenAt" < now() - interval '30 days')`,
    );
  } else if (filtro.atividade === "nunca") {
    condicoes.push(Prisma.sql`u."lastSeenAt" IS NULL`);
  }

  const onde = Prisma.sql`WHERE ${Prisma.join(condicoes, " AND ")}`;

  const ordenacao =
    filtro.ordem === "assistido"
      ? Prisma.sql`"tempoAssistidoMs" DESC NULLS LAST`
      : filtro.ordem === "ativos"
        ? Prisma.sql`u."lastSeenAt" DESC NULLS LAST`
        : filtro.ordem === "nome"
          ? Prisma.sql`u."name" ASC`
          : Prisma.sql`u."createdAt" DESC`;

  const [linhas, contagem] = await Promise.all([
    db.$queryRaw<LinhaDeUsuario[]>(Prisma.sql`
      SELECT
        u."id", u."name" AS nome, u."email", u."handle",
        u."avatarSeed" AS "avatarSeed",
        u."role"::text AS papel, u."status"::text AS status,
        u."isDemo" AS "isDemo",
        u."createdAt" AS "criadoEm", u."lastSeenAt" AS "ultimoAcesso",
        s."plan"::text AS plano, s."status"::text AS "statusAssinatura",
        coalesce(ses.n, 0)::int AS sessoes,
        coalesce(ses.tempo, 0)::float8 AS "tempoNaPlataformaMs",
        coalesce(prog.assistido, 0)::float8 AS "tempoAssistidoMs",
        coalesce(prog.iniciados, 0)::int AS "episodiosIniciados",
        coalesce(prog.concluidos, 0)::int AS "episodiosConcluidos"
      FROM "User" u
      LEFT JOIN "Subscription" s ON s."userId" = u."id"
      LEFT JOIN (
        SELECT "userId", count(*)::int AS n, sum("durationMs")::float8 AS tempo
        FROM "AppSession" WHERE "userId" IS NOT NULL GROUP BY 1
      ) ses ON ses."userId" = u."id"
      LEFT JOIN (
        SELECT "userId",
               sum("watchedMs")::float8 AS assistido,
               count(*)::int AS iniciados,
               count(*) FILTER (WHERE "completed")::int AS concluidos
        FROM "WatchProgress" GROUP BY 1
      ) prog ON prog."userId" = u."id"
      ${onde}
      ORDER BY ${ordenacao}
      LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}
    `),
    db.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n
      FROM "User" u
      LEFT JOIN "Subscription" s ON s."userId" = u."id"
      ${onde}
    `),
  ]);

  const total = contagem[0]?.n ?? 0;
  return {
    linhas,
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
  };
}
