import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { Periodo } from "@/lib/painel/tempo";

/**
 * Catálogo.
 *
 * As outras telas medem o que aconteceu num recorte; esta mede o que existe.
 * Inventário é estado, não série temporal — por isso quase nada aqui usa
 * período, e o que usa (publicações) diz isso no rótulo.
 *
 * Esta é também a tela onde a mentira do seed fica visível: `Novela.viewCount`,
 * `favoriteCount` e `watchedMs` foram semeados com números de vitrine. Em vez
 * de escondê-los, o painel os coloca lado a lado com o fato correspondente e
 * mostra o tamanho da divergência. `scripts/reconciliar-contadores.ts` é o que
 * fecha essa distância.
 */

export const STATUS = ["ONGOING", "COMPLETED", "COMING_SOON"] as const;
export const TIERS = ["FREE", "PREMIUM"] as const;

export type ResumoDoCatalogo = {
  novelas: number;
  emExibicao: number;
  concluidas: number;
  emBreve: number;
  destaques: number;
  temporadas: number;
  episodios: number;
  episodiosBonus: number;
  episodiosPremium: number;
  novelasPremium: number;
  duracaoTotalSeg: number;
  duracaoMediaSeg: number | null;
  generos: number;
  publicadasNoPeriodo: number;
  episodiosNoPeriodo: number;
  ultimaPublicacao: Date | null;
};

export async function resumoDoCatalogo(
  periodo: Periodo,
): Promise<ResumoDoCatalogo> {
  const [novelas, temporadas, episodios, generos, agregado, publicadas, novos, ultima] =
    await Promise.all([
      db.novela.groupBy({ by: ["status"], _count: { _all: true } }),
      db.season.count(),
      db.episode.count(),
      db.genre.count(),
      db.$queryRaw<
        {
          duracao: number | null;
          media: number | null;
          bonus: number;
          premium: number;
        }[]
      >(Prisma.sql`
        SELECT
          coalesce(sum("durationSec"), 0)::float8 AS duracao,
          avg("durationSec")::float8 AS media,
          count(*) FILTER (WHERE "isBonus")::int AS bonus,
          count(*) FILTER (WHERE "accessTier"::text <> 'FREE')::int AS premium
        FROM "Episode"
      `),
      db.novela.count({
        where: { releasedAt: { gte: periodo.inicio, lt: periodo.fim } },
      }),
      db.episode.count({
        where: { releasedAt: { gte: periodo.inicio, lt: periodo.fim } },
      }),
      db.episode.findFirst({
        orderBy: { releasedAt: "desc" },
        select: { releasedAt: true },
      }),
    ]);

  const porStatus = new Map(
    novelas.map((linha) => [linha.status as string, linha._count._all]),
  );
  const [destaques, novelasPremium] = await Promise.all([
    db.novela.count({ where: { isFeatured: true } }),
    db.novela.count({ where: { accessTier: { not: "FREE" } } }),
  ]);
  const bruto = agregado[0];

  return {
    novelas: novelas.reduce((total, linha) => total + linha._count._all, 0),
    emExibicao: porStatus.get("ONGOING") ?? 0,
    concluidas: porStatus.get("COMPLETED") ?? 0,
    emBreve: porStatus.get("COMING_SOON") ?? 0,
    destaques,
    temporadas,
    episodios,
    episodiosBonus: Number(bruto?.bonus ?? 0),
    episodiosPremium: Number(bruto?.premium ?? 0),
    novelasPremium,
    duracaoTotalSeg: Number(bruto?.duracao ?? 0),
    duracaoMediaSeg: episodios > 0 ? Number(bruto?.media ?? 0) : null,
    generos,
    publicadasNoPeriodo: publicadas,
    episodiosNoPeriodo: novos,
    ultimaPublicacao: ultima?.releasedAt ?? null,
  };
}

export type LinhaDoCatalogo = {
  id: string;
  titulo: string;
  slug: string;
  status: string;
  tier: string;
  ano: number;
  destaque: boolean;
  temporadas: number;
  episodios: number;
  duracaoSeg: number;
  publicadaEm: Date;
  atualizadaEm: Date;
  /** O que o contador denormalizado afirma. */
  viewCount: number;
  /** O que os eventos registram. */
  reproducoes: number;
};

export type OrdemDoCatalogo =
  | "titulo"
  | "recentes"
  | "episodios"
  | "duracao"
  | "divergencia";

export type FiltroDoCatalogo = {
  termo?: string;
  status?: string;
  tier?: string;
  apenasDestaques?: boolean;
  ordem?: OrdemDoCatalogo;
  pagina?: number;
  porPagina?: number;
};

/**
 * Reproduções reais por novela, do histórico inteiro.
 *
 * Sem recorte de período de propósito: `viewCount` é acumulado desde sempre, e
 * comparar um acumulado com uma janela de 30 dias produziria uma divergência
 * inventada pela própria comparação.
 */
async function reproducoesPorNovela(): Promise<Map<string, number>> {
  const linhas = await db.$queryRaw<{ id: string; total: number }[]>(Prisma.sql`
    SELECT "novelaId" AS id, count(*)::int AS total
    FROM "Event"
    WHERE "type"::text = 'PLAY_START' AND "novelaId" IS NOT NULL
    GROUP BY 1
  `);
  return new Map(linhas.map((linha) => [linha.id, Number(linha.total)]));
}

export async function listarNovelas(filtro: FiltroDoCatalogo): Promise<{
  linhas: LinhaDoCatalogo[];
  total: number;
  pagina: number;
  paginas: number;
}> {
  const porPagina = Math.min(100, Math.max(10, filtro.porPagina ?? 25));
  const pagina = Math.max(1, filtro.pagina ?? 1);

  const onde: Prisma.NovelaWhereInput = {};
  if (filtro.termo?.trim()) {
    const termo = filtro.termo.trim();
    onde.OR = [
      { title: { contains: termo, mode: "insensitive" } },
      { slug: { contains: termo, mode: "insensitive" } },
      { id: termo },
    ];
  }
  // Os valores vêm da URL, onde qualquer um pode escrever qualquer coisa.
  // Um enum inválido faz o Prisma lançar — filtro desconhecido é filtro
  // ignorado, não uma tela de erro.
  if (filtro.status && (STATUS as readonly string[]).includes(filtro.status)) {
    onde.status = filtro.status as (typeof STATUS)[number];
  }
  if (filtro.tier && (TIERS as readonly string[]).includes(filtro.tier)) {
    onde.accessTier = filtro.tier as (typeof TIERS)[number];
  }
  if (filtro.apenasDestaques) onde.isFeatured = true;

  const ordem =
    filtro.ordem === "titulo"
      ? { title: "asc" as const }
      : filtro.ordem === "episodios"
        ? { episodes: { _count: "desc" as const } }
        : { releasedAt: "desc" as const };

  const [total, novelas, reproducoes] = await Promise.all([
    db.novela.count({ where: onde }),
    db.novela.findMany({
      where: onde,
      orderBy: ordem,
      skip: (pagina - 1) * porPagina,
      take: porPagina,
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        accessTier: true,
        year: true,
        isFeatured: true,
        viewCount: true,
        releasedAt: true,
        updatedAt: true,
        _count: { select: { seasons: true, episodes: true } },
        episodes: { select: { durationSec: true } },
      },
    }),
    reproducoesPorNovela(),
  ]);

  const linhas: LinhaDoCatalogo[] = novelas.map((novela) => ({
    id: novela.id,
    titulo: novela.title,
    slug: novela.slug,
    status: novela.status,
    tier: novela.accessTier,
    ano: novela.year,
    destaque: novela.isFeatured,
    temporadas: novela._count.seasons,
    episodios: novela._count.episodes,
    duracaoSeg: novela.episodes.reduce(
      (soma, episodio) => soma + episodio.durationSec,
      0,
    ),
    publicadaEm: novela.releasedAt,
    atualizadaEm: novela.updatedAt,
    viewCount: novela.viewCount,
    reproducoes: reproducoes.get(novela.id) ?? 0,
  }));

  // Duração e divergência não são colunas do banco; ordenar por elas acontece
  // aqui, na página já carregada. Está declarado na interface para que ninguém
  // leia "mais longas" como um ranking do catálogo inteiro.
  if (filtro.ordem === "duracao") {
    linhas.sort((a, b) => b.duracaoSeg - a.duracaoSeg);
  } else if (filtro.ordem === "divergencia") {
    linhas.sort(
      (a, b) =>
        Math.abs(b.viewCount - b.reproducoes) -
        Math.abs(a.viewCount - a.reproducoes),
    );
  }

  return {
    linhas,
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
  };
}

export type Divergencia = {
  id: string;
  titulo: string;
  viewCount: number;
  reproducoes: number;
  favoriteCount: number;
  favoritos: number;
  watchedMs: number;
  tempoReal: number;
};

/** O placar entre o que os contadores afirmam e o que os fatos registram. */
export async function divergenciaDeContadores(
  limite = 10,
): Promise<{ linhas: Divergencia[]; totalDivergentes: number }> {
  const [novelas, reproducoes, favoritos, tempo] = await Promise.all([
    db.novela.findMany({
      select: {
        id: true,
        title: true,
        viewCount: true,
        favoriteCount: true,
        watchedMs: true,
      },
    }),
    reproducoesPorNovela(),
    db.$queryRaw<{ id: string; total: number }[]>(Prisma.sql`
      SELECT "novelaId" AS id, count(*)::int AS total FROM "Favorite" GROUP BY 1
    `),
    db.$queryRaw<{ id: string; total: number }[]>(Prisma.sql`
      SELECT "novelaId" AS id, coalesce(sum("valueMs"), 0)::float8 AS total
      FROM "Event"
      WHERE "type"::text = 'PLAY_PROGRESS' AND "novelaId" IS NOT NULL
      GROUP BY 1
    `),
  ]);

  const porFavorito = new Map(
    favoritos.map((linha) => [linha.id, Number(linha.total)]),
  );
  const porTempo = new Map(tempo.map((linha) => [linha.id, Number(linha.total)]));

  const linhas = novelas.map((novela) => ({
    id: novela.id,
    titulo: novela.title,
    viewCount: novela.viewCount,
    reproducoes: reproducoes.get(novela.id) ?? 0,
    favoriteCount: novela.favoriteCount,
    favoritos: porFavorito.get(novela.id) ?? 0,
    // BigInt vira Number na fronteira do repositório, nunca na tela.
    watchedMs: Number(novela.watchedMs),
    tempoReal: porTempo.get(novela.id) ?? 0,
  }));

  const divergentes = linhas.filter(
    (linha) =>
      linha.viewCount !== linha.reproducoes ||
      linha.favoriteCount !== linha.favoritos ||
      linha.watchedMs !== linha.tempoReal,
  );

  return {
    linhas: divergentes
      .sort(
        (a, b) =>
          Math.abs(b.viewCount - b.reproducoes) -
          Math.abs(a.viewCount - a.reproducoes),
      )
      .slice(0, limite),
    totalDivergentes: divergentes.length,
  };
}

export type EpisodioDoCatalogo = {
  id: string;
  numero: number;
  titulo: string;
  duracaoSeg: number;
  tier: string;
  bonus: boolean;
  mediaKey: string;
  mediaProvider: string;
  mediaFormat: string;
  publicadoEm: Date;
  viewCount: number;
  reproducoes: number;
};

export type TemporadaDoCatalogo = {
  id: string;
  numero: number;
  titulo: string;
  episodios: EpisodioDoCatalogo[];
  /** Números faltando na sequência — um episódio 4 sem episódio 3. */
  lacunas: number[];
};

export async function novelaNoCatalogo(novelaId: string) {
  const novela = await db.novela.findUnique({
    where: { id: novelaId },
    select: {
      id: true,
      title: true,
      slug: true,
      tagline: true,
      status: true,
      accessTier: true,
      ageRating: true,
      year: true,
      country: true,
      isFeatured: true,
      featuredRank: true,
      editorialNote: true,
      posterKey: true,
      heroKey: true,
      trailerKey: true,
      rating: true,
      ratingCount: true,
      viewCount: true,
      favoriteCount: true,
      watchedMs: true,
      releasedAt: true,
      updatedAt: true,
      tags: true,
      genres: { select: { genre: { select: { name: true, slug: true } } } },
      seasons: {
        orderBy: { number: "asc" },
        select: {
          id: true,
          number: true,
          title: true,
          episodes: {
            orderBy: { number: "asc" },
            select: {
              id: true,
              number: true,
              title: true,
              durationSec: true,
              accessTier: true,
              isBonus: true,
              mediaKey: true,
              mediaProvider: true,
              mediaFormat: true,
              releasedAt: true,
              viewCount: true,
            },
          },
        },
      },
    },
  });
  if (!novela) return null;

  const [reproducoes, favoritos, tempo] = await Promise.all([
    db.$queryRaw<{ id: string; total: number }[]>(Prisma.sql`
      SELECT "episodeId" AS id, count(*)::int AS total
      FROM "Event"
      WHERE "type"::text = 'PLAY_START' AND "novelaId" = ${novelaId}
        AND "episodeId" IS NOT NULL
      GROUP BY 1
    `),
    db.favorite.count({ where: { novelaId } }),
    db.$queryRaw<{ total: number }[]>(Prisma.sql`
      SELECT coalesce(sum("valueMs"), 0)::float8 AS total
      FROM "Event"
      WHERE "type"::text = 'PLAY_PROGRESS' AND "novelaId" = ${novelaId}
    `),
  ]);
  const porEpisodio = new Map(
    reproducoes.map((linha) => [linha.id, Number(linha.total)]),
  );

  const temporadas: TemporadaDoCatalogo[] = novela.seasons.map((temporada) => {
    const numeros = temporada.episodes
      .filter((episodio) => !episodio.isBonus)
      .map((episodio) => episodio.number);
    const maximo = numeros.length ? Math.max(...numeros) : 0;
    const presentes = new Set(numeros);
    const lacunas: number[] = [];
    for (let n = 1; n <= maximo; n += 1) {
      if (!presentes.has(n)) lacunas.push(n);
    }

    return {
      id: temporada.id,
      numero: temporada.number,
      titulo: temporada.title,
      lacunas,
      episodios: temporada.episodes.map((episodio) => ({
        id: episodio.id,
        numero: episodio.number,
        titulo: episodio.title,
        duracaoSeg: episodio.durationSec,
        tier: episodio.accessTier,
        bonus: episodio.isBonus,
        mediaKey: episodio.mediaKey,
        mediaProvider: episodio.mediaProvider,
        mediaFormat: episodio.mediaFormat,
        publicadoEm: episodio.releasedAt,
        viewCount: episodio.viewCount,
        reproducoes: porEpisodio.get(episodio.id) ?? 0,
      })),
    };
  });

  const totalEpisodios = temporadas.reduce(
    (soma, temporada) => soma + temporada.episodios.length,
    0,
  );
  const duracaoSeg = temporadas.reduce(
    (soma, temporada) =>
      soma +
      temporada.episodios.reduce(
        (parcial, episodio) => parcial + episodio.duracaoSeg,
        0,
      ),
    0,
  );

  return {
    novela: {
      ...novela,
      watchedMs: Number(novela.watchedMs),
      generos: novela.genres.map((ligacao) => ligacao.genre),
    },
    temporadas,
    totalEpisodios,
    duracaoSeg,
    reproducoesReais: [...porEpisodio.values()].reduce(
      (soma, valor) => soma + valor,
      0,
    ),
    favoritosReais: favoritos,
    tempoRealMs: Number(tempo[0]?.total ?? 0),
  };
}
