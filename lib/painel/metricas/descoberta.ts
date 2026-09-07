import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { indicador, type Indicador } from "@/lib/painel/numeros";
import type { Periodo } from "@/lib/painel/tempo";
import {
  serieTemporal,
  totalNoPeriodo,
  type Serie,
} from "@/lib/painel/metricas/base";

/**
 * Descoberta.
 *
 * Uma tabela de fatos só: `SearchQuery`. Cada linha é uma busca que alguém
 * digitou, com quantos resultados voltaram (`resultCount`) e para qual novela
 * a pessoa foi depois (`clickedNovelaId`). Isso basta para as duas perguntas
 * da tela — o que procuram e o que não encontram — sem inferir nada.
 *
 * `normalized` é a chave de agrupamento: "Coração", "coracao" e "CORAÇÃO" são
 * a mesma demanda. `term` é preservado para mostrar como a pessoa escreveu.
 */

/**
 * Pessoas que buscaram.
 *
 * Quem não entrou não tem `userId`; a sessão é o que resta para separar duas
 * pessoas. Uma busca sem conta e sem sessão não tem como ser agrupada com
 * outra, então conta por si mesma (`id`) — o número erra para cima nesse caso,
 * nunca colapsando gente distinta numa pessoa só.
 */
const PESSOAS_QUE_BUSCARAM = Prisma.sql`count(DISTINCT coalesce("userId", "sessionId", "id"))::float8`;
const TERMOS_DISTINTOS = Prisma.sql`count(DISTINCT "normalized")::float8`;
const SEM_RESULTADO = Prisma.sql`"resultCount" = 0`;
const COM_CLIQUE = Prisma.sql`"clickedNovelaId" IS NOT NULL`;

export type CoberturaDescoberta = {
  desde: Date | null;
  parcial: boolean;
};

export type ResumoDescoberta = {
  buscas: Indicador;
  pessoas: Indicador;
  termosDistintos: Indicador;
  semResultado: Indicador;
  cliques: Indicador;
  taxaSemResultado: number | null;
  taxaClique: number | null;
  resultadoMedio: number | null;
  cobertura: CoberturaDescoberta;
  series: {
    buscas: Serie;
    buscasAnterior: Serie;
    semResultado: Serie;
  };
};

export type LinhaDeTermo = {
  termo: string;
  exemplo: string;
  buscas: number;
  pessoas: number;
  semResultado: number;
  cliques: number;
  resultadoMedio: number | null;
  ultimaVez: Date;
  taxaSemResultado: number | null;
  taxaClique: number | null;
};

export type OrdemDeTermos = "buscas" | "sem-resultado" | "recentes" | "alfabetica";

export type FiltroDeTermos = {
  periodo: Periodo;
  termo?: string;
  apenasFalhas?: boolean;
  ordem?: OrdemDeTermos;
  pagina?: number;
  porPagina?: number;
};

function taxa(parte: number, total: number): number | null {
  return total > 0 ? parte / total : null;
}

function juntar(principal: Prisma.Sql, extra?: Prisma.Sql): Prisma.Sql {
  return extra ? Prisma.sql`${principal} AND ${extra}` : principal;
}

function filtroDoTermo(termo?: string): Prisma.Sql | undefined {
  return termo ? Prisma.sql`"normalized" = ${termo}` : undefined;
}

async function cobertura(
  periodo: Periodo,
  termo?: string,
): Promise<CoberturaDescoberta> {
  const filtro = filtroDoTermo(termo);
  const linhas = await db.$queryRaw<{ primeiro: Date | null }[]>(Prisma.sql`
    SELECT min("createdAt") AS primeiro
    FROM "SearchQuery"
    ${filtro ? Prisma.sql`WHERE ${filtro}` : Prisma.empty}
  `);
  const desde = linhas[0]?.primeiro ?? null;
  return { desde, parcial: desde !== null && desde > periodo.inicio };
}

export async function resumoDeDescoberta(
  periodo: Periodo,
  termo?: string,
): Promise<ResumoDescoberta> {
  const escopo = filtroDoTermo(termo);
  const comum = { tabela: "SearchQuery", coluna: "createdAt", periodo } as const;

  const [
    buscas,
    pessoas,
    termos,
    semResultado,
    cliques,
    media,
    quandoComeca,
    serieBuscas,
    serieBuscasAnterior,
    serieSemResultado,
  ] = await Promise.all([
    totalNoPeriodo({ ...comum, filtro: escopo }),
    totalNoPeriodo({ ...comum, expressao: PESSOAS_QUE_BUSCARAM, filtro: escopo }),
    totalNoPeriodo({ ...comum, expressao: TERMOS_DISTINTOS, filtro: escopo }),
    totalNoPeriodo({ ...comum, filtro: juntar(SEM_RESULTADO, escopo) }),
    totalNoPeriodo({ ...comum, filtro: juntar(COM_CLIQUE, escopo) }),
    totalNoPeriodo({
      ...comum,
      expressao: Prisma.sql`avg("resultCount")::float8`,
      filtro: escopo,
    }),
    cobertura(periodo, termo),
    serieTemporal({ ...comum, filtro: escopo }),
    serieTemporal({ ...comum, anterior: true, filtro: escopo }),
    serieTemporal({ ...comum, filtro: juntar(SEM_RESULTADO, escopo) }),
  ]);

  return {
    buscas: indicador(buscas.atual, buscas.anterior),
    pessoas: indicador(pessoas.atual, pessoas.anterior),
    termosDistintos: indicador(termos.atual, termos.anterior),
    semResultado: indicador(semResultado.atual, semResultado.anterior),
    cliques: indicador(cliques.atual, cliques.anterior),
    taxaSemResultado: taxa(semResultado.atual, buscas.atual),
    taxaClique: taxa(cliques.atual, buscas.atual),
    // `avg` sobre zero linha volta nulo e a fronteira converte para 0; sem
    // busca no recorte não existe média para mostrar.
    resultadoMedio: buscas.atual > 0 ? media.atual : null,
    cobertura: quandoComeca,
    series: {
      buscas: serieBuscas,
      buscasAnterior: serieBuscasAnterior,
      semResultado: serieSemResultado,
    },
  };
}

type TermoBruto = {
  termo: string;
  exemplo: string;
  buscas: number;
  pessoas: number;
  semResultado: number;
  cliques: number;
  resultadoMedio: number | null;
  ultimaVez: Date;
};

function montarTermo(linha: TermoBruto): LinhaDeTermo {
  const buscas = Number(linha.buscas);
  const semResultado = Number(linha.semResultado);
  const cliques = Number(linha.cliques);
  return {
    termo: linha.termo,
    exemplo: linha.exemplo,
    buscas,
    pessoas: Number(linha.pessoas),
    semResultado,
    cliques,
    resultadoMedio:
      linha.resultadoMedio === null ? null : Number(linha.resultadoMedio),
    ultimaVez: linha.ultimaVez,
    taxaSemResultado: taxa(semResultado, buscas),
    taxaClique: taxa(cliques, buscas),
  };
}

const AGREGADO_DE_TERMO = Prisma.sql`
  "normalized" AS termo,
  (array_agg("term" ORDER BY "createdAt" DESC))[1] AS exemplo,
  count(*)::int AS buscas,
  count(DISTINCT coalesce("userId", "sessionId", "id"))::int AS pessoas,
  count(*) FILTER (WHERE "resultCount" = 0)::int AS "semResultado",
  count(*) FILTER (WHERE "clickedNovelaId" IS NOT NULL)::int AS cliques,
  avg("resultCount")::float8 AS "resultadoMedio",
  max("createdAt") AS "ultimaVez"
`;

export async function listarTermos(filtro: FiltroDeTermos): Promise<{
  linhas: LinhaDeTermo[];
  total: number;
  pagina: number;
  paginas: number;
}> {
  const porPagina = Math.min(100, Math.max(10, filtro.porPagina ?? 25));
  const pagina = Math.max(1, filtro.pagina ?? 1);
  const { periodo } = filtro;

  const condicoes: Prisma.Sql[] = [
    Prisma.sql`"createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}`,
  ];
  const procurado = filtro.termo?.trim().toLowerCase();
  if (procurado) {
    condicoes.push(
      Prisma.sql`(lower("normalized") LIKE ${`%${procurado}%`} OR lower("term") LIKE ${`%${procurado}%`})`,
    );
  }
  const onde = Prisma.sql`WHERE ${Prisma.join(condicoes, " AND ")}`;

  // Um termo "que falha" é o que voltou vazio pelo menos uma vez no recorte —
  // não o que só falha. Filtrar linha a linha esconderia que o mesmo termo às
  // vezes encontra, que é justamente o sintoma interessante.
  const tendo = filtro.apenasFalhas
    ? Prisma.sql`HAVING count(*) FILTER (WHERE "resultCount" = 0) > 0`
    : Prisma.empty;

  const ordenacao =
    filtro.ordem === "sem-resultado"
      ? Prisma.sql`"semResultado" DESC, buscas DESC`
      : filtro.ordem === "recentes"
        ? Prisma.sql`"ultimaVez" DESC`
        : filtro.ordem === "alfabetica"
          ? Prisma.sql`termo ASC`
          : Prisma.sql`buscas DESC, "ultimaVez" DESC`;

  const [linhas, contagem] = await Promise.all([
    db.$queryRaw<TermoBruto[]>(Prisma.sql`
      SELECT ${AGREGADO_DE_TERMO}
      FROM "SearchQuery"
      ${onde}
      GROUP BY "normalized"
      ${tendo}
      ORDER BY ${ordenacao}
      LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}
    `),
    db.$queryRaw<{ total: number }[]>(Prisma.sql`
      SELECT count(*)::int AS total FROM (
        SELECT 1
        FROM "SearchQuery"
        ${onde}
        GROUP BY "normalized"
        ${tendo}
      ) AS agrupado
    `),
  ]);

  const total = Number(contagem[0]?.total ?? 0);
  return {
    linhas: linhas.map(montarTermo),
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
  };
}

export type ItemDeRanking = {
  chave: string;
  rotulo: string;
  valor: number;
  nota?: string;
};

/** Os termos que mais voltaram vazios — a lista de compras do catálogo. */
export async function lacunasDeCatalogo(
  periodo: Periodo,
  limite = 8,
): Promise<ItemDeRanking[]> {
  const linhas = await db.$queryRaw<
    { termo: string; exemplo: string; total: number; pessoas: number }[]
  >(Prisma.sql`
    SELECT
      "normalized" AS termo,
      (array_agg("term" ORDER BY "createdAt" DESC))[1] AS exemplo,
      count(*)::int AS total,
      count(DISTINCT coalesce("userId", "sessionId", "id"))::int AS pessoas
    FROM "SearchQuery"
    WHERE "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
      AND "resultCount" = 0
    GROUP BY 1
    ORDER BY total DESC, termo ASC
    LIMIT ${limite}
  `);

  return linhas.map((linha) => {
    const pessoas = Number(linha.pessoas);
    return {
      chave: linha.termo,
      rotulo: linha.exemplo,
      valor: Number(linha.total),
      nota: `${pessoas} ${pessoas === 1 ? "pessoa" : "pessoas"}`,
    };
  });
}

/** Para onde a busca leva: novelas abertas a partir de um resultado. */
export async function destinosDaBusca(
  periodo: Periodo,
  limite = 8,
): Promise<ItemDeRanking[]> {
  const linhas = await db.$queryRaw<{ id: string; total: number }[]>(Prisma.sql`
    SELECT "clickedNovelaId" AS id, count(*)::int AS total
    FROM "SearchQuery"
    WHERE "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
      AND "clickedNovelaId" IS NOT NULL
    GROUP BY 1
    ORDER BY total DESC
    LIMIT ${limite}
  `);
  if (linhas.length === 0) return [];

  const novelas = await db.novela.findMany({
    where: { id: { in: linhas.map((linha) => linha.id) } },
    select: { id: true, title: true },
  });
  const porId = new Map(novelas.map((novela) => [novela.id, novela.title]));

  return linhas.map((linha) => ({
    chave: linha.id,
    rotulo: porId.get(linha.id) ?? "Novela removida",
    valor: Number(linha.total),
  }));
}

export type BuscaRecente = {
  id: string;
  term: string;
  resultCount: number;
  createdAt: Date;
  clickedNovelaId: string | null;
  novelaClicada: string | null;
  quem: { id: string; nome: string; handle: string } | null;
};

export type DetalheDoTermo = {
  termo: string;
  exemplo: string;
  resumo: ResumoDescoberta;
  variantes: { term: string; buscas: number; ultimaVez: Date }[];
  destinos: ItemDeRanking[];
  recentes: BuscaRecente[];
};

export async function detalheDoTermo(
  termo: string,
  periodo: Periodo,
): Promise<DetalheDoTermo | null> {
  // O termo pode não ter sido buscado no recorte atual e ainda assim existir.
  // Quem chega por um link antigo merece a página com zero, não um 404.
  const existe = await db.searchQuery.findFirst({
    where: { normalized: termo },
    orderBy: { createdAt: "desc" },
    select: { term: true },
  });
  if (!existe) return null;

  const [resumo, variantes, cliques, recentes] = await Promise.all([
    resumoDeDescoberta(periodo, termo),
    db.$queryRaw<{ term: string; buscas: number; ultimaVez: Date }[]>(Prisma.sql`
      SELECT "term", count(*)::int AS buscas, max("createdAt") AS "ultimaVez"
      FROM "SearchQuery"
      WHERE "normalized" = ${termo}
        AND "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
      GROUP BY 1
      ORDER BY buscas DESC, "ultimaVez" DESC
      LIMIT 12
    `),
    db.$queryRaw<{ id: string; total: number }[]>(Prisma.sql`
      SELECT "clickedNovelaId" AS id, count(*)::int AS total
      FROM "SearchQuery"
      WHERE "normalized" = ${termo}
        AND "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
        AND "clickedNovelaId" IS NOT NULL
      GROUP BY 1
      ORDER BY total DESC
      LIMIT 8
    `),
    db.searchQuery.findMany({
      where: {
        normalized: termo,
        createdAt: { gte: periodo.inicio, lt: periodo.fim },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        term: true,
        resultCount: true,
        createdAt: true,
        clickedNovelaId: true,
        user: { select: { id: true, name: true, handle: true } },
      },
    }),
  ]);

  const idsDeNovela = [
    ...new Set(
      [
        ...cliques.map((linha) => linha.id),
        ...recentes.map((linha) => linha.clickedNovelaId),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const novelas = idsDeNovela.length
    ? await db.novela.findMany({
        where: { id: { in: idsDeNovela } },
        select: { id: true, title: true },
      })
    : [];
  const titulo = new Map(novelas.map((novela) => [novela.id, novela.title]));

  return {
    termo,
    exemplo: existe.term,
    resumo,
    variantes: variantes.map((linha) => ({
      term: linha.term,
      buscas: Number(linha.buscas),
      ultimaVez: linha.ultimaVez,
    })),
    destinos: cliques.map((linha) => ({
      chave: linha.id,
      rotulo: titulo.get(linha.id) ?? "Novela removida",
      valor: Number(linha.total),
    })),
    recentes: recentes.map((linha) => ({
      id: linha.id,
      term: linha.term,
      resultCount: linha.resultCount,
      createdAt: linha.createdAt,
      clickedNovelaId: linha.clickedNovelaId,
      novelaClicada: linha.clickedNovelaId
        ? (titulo.get(linha.clickedNovelaId) ?? "Novela removida")
        : null,
      quem: linha.user
        ? { id: linha.user.id, nome: linha.user.name, handle: linha.user.handle }
        : null,
    })),
  };
}
