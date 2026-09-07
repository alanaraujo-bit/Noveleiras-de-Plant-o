import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { indicador, type Indicador } from "@/lib/painel/numeros";
import type { Periodo } from "@/lib/painel/tempo";
import {
  agoraMenos,
  eventosDoTipo,
  JANELA_AGORA_MS,
  PESSOAS_DISTINTAS,
  serieTemporal,
  SOMAR_MS,
  totalNoPeriodo,
  type Serie,
} from "@/lib/painel/metricas/base";

export type EscopoStreaming = {
  novelaId?: string;
  episodeIds?: string[];
};

export type CoberturaStreaming = {
  desde: Date | null;
  parcial: boolean;
};

export type ResumoStreaming = {
  assistindoAgora: number;
  reproducoes: Indicador;
  espectadores: Indicador;
  tempoAssistidoMs: Indicador;
  conclusoes: Indicador;
  abandonos: Indicador;
  erros: Indicador;
  taxaConclusao: number | null;
  taxaAbandono: number | null;
  taxaErro: number | null;
  coberturaTempo: CoberturaStreaming;
  series: {
    reproducoes: Serie;
    reproducoesAnterior: Serie;
    conclusoes: Serie;
    erros: Serie;
  };
};

export type LinhaStreaming = {
  id: string;
  titulo: string;
  detalhe?: string;
  reproducoes: number;
  espectadores: number;
  tempoAssistidoMs: number;
  conclusoes: number;
  abandonos: number;
  erros: number;
  taxaConclusao: number | null;
};

type AgregadoBruto = {
  id: string;
  reproducoes: number;
  espectadores: number;
  tempoAssistidoMs: number;
  conclusoes: number;
  erros: number;
};

function filtroDoEscopo(
  escopo: EscopoStreaming,
  colunaNovela = "novelaId",
  colunaEpisodio = "episodeId",
): Prisma.Sql | undefined {
  if (escopo.episodeIds) {
    if (escopo.episodeIds.length === 0) return Prisma.sql`false`;
    return Prisma.sql`${Prisma.raw(`"${colunaEpisodio}"`)} IN (${Prisma.join(escopo.episodeIds)})`;
  }
  if (escopo.novelaId) {
    return Prisma.sql`${Prisma.raw(`"${colunaNovela}"`)} = ${escopo.novelaId}`;
  }
  return undefined;
}

function juntarFiltros(principal: Prisma.Sql, extra?: Prisma.Sql): Prisma.Sql {
  return extra ? Prisma.sql`${principal} AND ${extra}` : principal;
}

function taxa(parte: number, total: number): number | null {
  return total > 0 ? parte / total : null;
}

async function coberturaTempo(
  periodo: Periodo,
  escopo: EscopoStreaming,
): Promise<CoberturaStreaming> {
  const filtro = filtroDoEscopo(escopo);
  const linhas = await db.$queryRaw<{ primeiro: Date | null }[]>(Prisma.sql`
    SELECT min("createdAt") AS primeiro
    FROM "Event"
    WHERE "type"::text = 'PLAY_PROGRESS'
    ${filtro ? Prisma.sql`AND ${filtro}` : Prisma.empty}
  `);
  const desde = linhas[0]?.primeiro ?? null;
  return { desde, parcial: desde !== null && desde > periodo.inicio };
}

async function assistindoAgora(escopo: EscopoStreaming): Promise<number> {
  const filtro = filtroDoEscopo(escopo);
  const limite = agoraMenos(JANELA_AGORA_MS);
  const linhas = await db.$queryRaw<{ total: number }[]>(Prisma.sql`
    SELECT count(DISTINCT coalesce("userId", "deviceId", "sessionId"))::float8 AS total
    FROM "Event"
    WHERE "type"::text = 'PLAY_PROGRESS'
      AND "createdAt" >= ${limite}
      ${filtro ? Prisma.sql`AND ${filtro}` : Prisma.empty}
  `);
  return Number(linhas[0]?.total ?? 0);
}

export async function resumoStreaming(
  periodo: Periodo,
  escopo: EscopoStreaming = {},
): Promise<ResumoStreaming> {
  const filtroEvento = filtroDoEscopo(escopo);
  const filtroProgresso = filtroDoEscopo(escopo);
  const filtroAbandono = juntarFiltros(
    Prisma.sql`"completed" = false AND "abandonedAt" IS NOT NULL`,
    filtroProgresso,
  );

  const [
    agora,
    reproducoes,
    espectadores,
    tempoAssistido,
    conclusoes,
    abandonos,
    erros,
    cobertura,
    serieReproducoes,
    serieReproducoesAnterior,
    serieConclusoes,
    serieErros,
  ] = await Promise.all([
    assistindoAgora(escopo),
    totalNoPeriodo({
      tabela: "Event",
      coluna: "createdAt",
      periodo,
      filtro: juntarFiltros(eventosDoTipo("PLAY_START"), filtroEvento),
    }),
    totalNoPeriodo({
      tabela: "Event",
      coluna: "createdAt",
      periodo,
      expressao: PESSOAS_DISTINTAS,
      filtro: juntarFiltros(eventosDoTipo("PLAY_START"), filtroEvento),
    }),
    totalNoPeriodo({
      tabela: "Event",
      coluna: "createdAt",
      periodo,
      expressao: SOMAR_MS,
      filtro: juntarFiltros(eventosDoTipo("PLAY_PROGRESS"), filtroEvento),
    }),
    totalNoPeriodo({
      tabela: "Event",
      coluna: "createdAt",
      periodo,
      filtro: juntarFiltros(eventosDoTipo("PLAY_COMPLETE"), filtroEvento),
    }),
    totalNoPeriodo({
      tabela: "WatchProgress",
      coluna: "updatedAt",
      periodo,
      filtro: filtroAbandono,
    }),
    totalNoPeriodo({
      tabela: "Event",
      coluna: "createdAt",
      periodo,
      filtro: juntarFiltros(eventosDoTipo("PLAY_ERROR"), filtroEvento),
    }),
    coberturaTempo(periodo, escopo),
    serieTemporal({
      tabela: "Event",
      coluna: "createdAt",
      periodo,
      filtro: juntarFiltros(eventosDoTipo("PLAY_START"), filtroEvento),
    }),
    serieTemporal({
      tabela: "Event",
      coluna: "createdAt",
      periodo,
      anterior: true,
      filtro: juntarFiltros(eventosDoTipo("PLAY_START"), filtroEvento),
    }),
    serieTemporal({
      tabela: "Event",
      coluna: "createdAt",
      periodo,
      filtro: juntarFiltros(eventosDoTipo("PLAY_COMPLETE"), filtroEvento),
    }),
    serieTemporal({
      tabela: "Event",
      coluna: "createdAt",
      periodo,
      filtro: juntarFiltros(eventosDoTipo("PLAY_ERROR"), filtroEvento),
    }),
  ]);

  return {
    assistindoAgora: agora,
    reproducoes: indicador(reproducoes.atual, reproducoes.anterior),
    espectadores: indicador(espectadores.atual, espectadores.anterior),
    tempoAssistidoMs: indicador(tempoAssistido.atual, tempoAssistido.anterior),
    conclusoes: indicador(conclusoes.atual, conclusoes.anterior),
    abandonos: indicador(abandonos.atual, abandonos.anterior),
    erros: indicador(erros.atual, erros.anterior),
    taxaConclusao: taxa(conclusoes.atual, reproducoes.atual),
    taxaAbandono: taxa(abandonos.atual, reproducoes.atual),
    taxaErro: taxa(erros.atual, reproducoes.atual),
    coberturaTempo: cobertura,
    series: {
      reproducoes: serieReproducoes,
      reproducoesAnterior: serieReproducoesAnterior,
      conclusoes: serieConclusoes,
      erros: serieErros,
    },
  };
}

async function abandonosPor(
  coluna: "novelaId" | "episodeId",
  periodo: Periodo,
  filtro?: Prisma.Sql,
): Promise<Map<string, number>> {
  const identificador = Prisma.raw(`"${coluna}"`);
  const linhas = await db.$queryRaw<{ id: string; total: number }[]>(Prisma.sql`
    SELECT ${identificador} AS id, count(*)::int AS total
    FROM "WatchProgress"
    WHERE "updatedAt" >= ${periodo.inicio} AND "updatedAt" < ${periodo.fim}
      AND "completed" = false AND "abandonedAt" IS NOT NULL
      AND ${identificador} IS NOT NULL
      ${filtro ? Prisma.sql`AND ${filtro}` : Prisma.empty}
    GROUP BY 1
  `);
  return new Map(linhas.map((linha) => [linha.id, Number(linha.total)]));
}

export async function novelasStreaming(periodo: Periodo): Promise<LinhaStreaming[]> {
  const [eventos, abandonos] = await Promise.all([
    db.$queryRaw<AgregadoBruto[]>(Prisma.sql`
      SELECT
        "novelaId" AS id,
        count(*) FILTER (WHERE "type"::text = 'PLAY_START')::int AS reproducoes,
        count(DISTINCT coalesce("userId", "deviceId", "sessionId"))
          FILTER (WHERE "type"::text = 'PLAY_START')::int AS espectadores,
        coalesce(sum("valueMs") FILTER (WHERE "type"::text = 'PLAY_PROGRESS'), 0)::float8
          AS "tempoAssistidoMs",
        count(*) FILTER (WHERE "type"::text = 'PLAY_COMPLETE')::int AS conclusoes,
        count(*) FILTER (WHERE "type"::text = 'PLAY_ERROR')::int AS erros
      FROM "Event"
      WHERE "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
        AND "novelaId" IS NOT NULL
        AND "type"::text IN ('PLAY_START', 'PLAY_PROGRESS', 'PLAY_COMPLETE', 'PLAY_ERROR')
      GROUP BY 1
    `),
    abandonosPor("novelaId", periodo),
  ]);

  const ids = eventos.map((linha) => linha.id);
  const novelas = ids.length
    ? await db.novela.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true, status: true },
      })
    : [];
  const porId = new Map(novelas.map((novela) => [novela.id, novela]));

  return eventos
    .map((linha) => {
      const novela = porId.get(linha.id);
      const reproducoes = Number(linha.reproducoes);
      const conclusoes = Number(linha.conclusoes);
      return {
        id: linha.id,
        titulo: novela?.title ?? "Novela removida",
        detalhe: novela?.status === "ONGOING" ? "em exibição" : novela?.status === "COMPLETED" ? "concluída" : "em breve",
        reproducoes,
        espectadores: Number(linha.espectadores),
        tempoAssistidoMs: Number(linha.tempoAssistidoMs),
        conclusoes,
        abandonos: abandonos.get(linha.id) ?? 0,
        erros: Number(linha.erros),
        taxaConclusao: taxa(conclusoes, reproducoes),
      };
    })
    .sort((a, b) => b.reproducoes - a.reproducoes || b.tempoAssistidoMs - a.tempoAssistidoMs);
}

export async function novelaComTemporadas(novelaId: string, periodo: Periodo) {
  const novela = await db.novela.findUnique({
    where: { id: novelaId },
    select: {
      id: true,
      title: true,
      seasons: {
        orderBy: { number: "asc" },
        select: {
          id: true,
          number: true,
          title: true,
          episodes: { select: { id: true } },
        },
      },
    },
  });
  if (!novela) return null;

  const linhas = await Promise.all(
    novela.seasons.map(async (temporada) => {
      const ids = temporada.episodes.map((episodio) => episodio.id);
      const filtro = filtroDoEscopo({ episodeIds: ids });
      const [agregado, abandonos] = await Promise.all([
        db.$queryRaw<Omit<AgregadoBruto, "id">[]>(Prisma.sql`
          SELECT
            count(*) FILTER (WHERE "type"::text = 'PLAY_START')::int AS reproducoes,
            count(DISTINCT coalesce("userId", "deviceId", "sessionId"))
              FILTER (WHERE "type"::text = 'PLAY_START')::int AS espectadores,
            coalesce(sum("valueMs") FILTER (WHERE "type"::text = 'PLAY_PROGRESS'), 0)::float8
              AS "tempoAssistidoMs",
            count(*) FILTER (WHERE "type"::text = 'PLAY_COMPLETE')::int AS conclusoes,
            count(*) FILTER (WHERE "type"::text = 'PLAY_ERROR')::int AS erros
          FROM "Event"
          WHERE "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
            AND ${filtro ?? Prisma.sql`false`}
        `),
        ids.length
          ? db.watchProgress.count({
              where: {
                episodeId: { in: ids },
                updatedAt: { gte: periodo.inicio, lt: periodo.fim },
                completed: false,
                abandonedAt: { not: null },
              },
            })
          : 0,
      ]);
      const bruto = agregado[0];
      const reproducoes = Number(bruto?.reproducoes ?? 0);
      const conclusoes = Number(bruto?.conclusoes ?? 0);
      return {
        id: temporada.id,
        titulo: temporada.title,
        detalhe: `${temporada.episodes.length} ${temporada.episodes.length === 1 ? "episódio" : "episódios"}`,
        reproducoes,
        espectadores: Number(bruto?.espectadores ?? 0),
        tempoAssistidoMs: Number(bruto?.tempoAssistidoMs ?? 0),
        conclusoes,
        abandonos: Number(abandonos),
        erros: Number(bruto?.erros ?? 0),
        taxaConclusao: taxa(conclusoes, reproducoes),
        numero: temporada.number,
        episodeIds: ids,
      };
    }),
  );

  return { ...novela, linhas };
}

export async function temporadaComEpisodios(
  novelaId: string,
  temporadaId: string,
  periodo: Periodo,
) {
  const temporada = await db.season.findFirst({
    where: { id: temporadaId, novelaId },
    select: {
      id: true,
      number: true,
      title: true,
      novela: { select: { id: true, title: true } },
      episodes: {
        orderBy: { number: "asc" },
        select: { id: true, number: true, title: true, durationSec: true, isBonus: true },
      },
    },
  });
  if (!temporada) return null;

  const ids = temporada.episodes.map((episodio) => episodio.id);
  if (ids.length === 0) {
    return {
      ...temporada,
      linhas: [] as (LinhaStreaming & { numero: number })[],
      episodeIds: ids,
    };
  }

  const [eventos, abandonos] = await Promise.all([
    db.$queryRaw<AgregadoBruto[]>(Prisma.sql`
      SELECT
        "episodeId" AS id,
        count(*) FILTER (WHERE "type"::text = 'PLAY_START')::int AS reproducoes,
        count(DISTINCT coalesce("userId", "deviceId", "sessionId"))
          FILTER (WHERE "type"::text = 'PLAY_START')::int AS espectadores,
        coalesce(sum("valueMs") FILTER (WHERE "type"::text = 'PLAY_PROGRESS'), 0)::float8
          AS "tempoAssistidoMs",
        count(*) FILTER (WHERE "type"::text = 'PLAY_COMPLETE')::int AS conclusoes,
        count(*) FILTER (WHERE "type"::text = 'PLAY_ERROR')::int AS erros
      FROM "Event"
      WHERE "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
        AND "episodeId" IN (${Prisma.join(ids)})
        AND "type"::text IN ('PLAY_START', 'PLAY_PROGRESS', 'PLAY_COMPLETE', 'PLAY_ERROR')
      GROUP BY 1
    `),
    abandonosPor("episodeId", periodo, Prisma.sql`"episodeId" IN (${Prisma.join(ids)})`),
  ]);
  const porId = new Map(eventos.map((linha) => [linha.id, linha]));

  return {
    ...temporada,
    linhas: temporada.episodes.map((episodio) => {
      const bruto = porId.get(episodio.id);
      const reproducoes = Number(bruto?.reproducoes ?? 0);
      const conclusoes = Number(bruto?.conclusoes ?? 0);
      return {
        id: episodio.id,
        titulo: episodio.title,
        detalhe: `${Math.max(1, Math.round(episodio.durationSec / 60))} min${episodio.isBonus ? " · bônus" : ""}`,
        reproducoes,
        espectadores: Number(bruto?.espectadores ?? 0),
        tempoAssistidoMs: Number(bruto?.tempoAssistidoMs ?? 0),
        conclusoes,
        abandonos: abandonos.get(episodio.id) ?? 0,
        erros: Number(bruto?.erros ?? 0),
        taxaConclusao: taxa(conclusoes, reproducoes),
        numero: episodio.number,
      };
    }),
    episodeIds: ids,
  };
}

export async function detalheDoEpisodio(
  novelaId: string,
  temporadaId: string,
  episodioId: string,
  periodo: Periodo,
) {
  const episodio = await db.episode.findFirst({
    where: { id: episodioId, novelaId, seasonId: temporadaId },
    select: {
      id: true,
      number: true,
      title: true,
      durationSec: true,
      mediaProvider: true,
      mediaFormat: true,
      novela: { select: { id: true, title: true } },
      season: { select: { id: true, number: true, title: true } },
    },
  });
  if (!episodio) return null;

  const [resumo, abandonos, errosRecentes] = await Promise.all([
    resumoStreaming(periodo, { episodeIds: [episodioId] }),
    db.watchProgress.findMany({
      where: {
        episodeId: episodioId,
        updatedAt: { gte: periodo.inicio, lt: periodo.fim },
        completed: false,
        abandonedAt: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      select: { abandonedAt: true, durationSec: true, updatedAt: true },
    }),
    db.event.findMany({
      where: {
        episodeId: episodioId,
        type: "PLAY_ERROR",
        createdAt: { gte: periodo.inicio, lt: periodo.fim },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, createdAt: true, sessionId: true, payload: true },
    }),
  ]);

  const faixas = [0, 0, 0, 0];
  for (const linha of abandonos) {
    const proporcao = linha.durationSec > 0 ? (linha.abandonedAt ?? 0) / linha.durationSec : 0;
    faixas[Math.min(3, Math.max(0, Math.floor(proporcao * 4)))] += 1;
  }

  return { episodio, resumo, faixasAbandono: faixas, errosRecentes };
}
