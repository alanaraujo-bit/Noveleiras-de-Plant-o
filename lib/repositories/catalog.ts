import "server-only";

import { db } from "@/lib/db";
import {
  posterUrl,
  resolveMedia,
  type MediaSource,
} from "@/lib/media/resolver";
import {
  ANONYMOUS_ENTITLEMENT,
  canWatchEpisode,
  type Entitlement,
  type MotivoBloqueado,
} from "@/lib/access/entitlements";
import type { Viewer } from "@/lib/auth/session";
import { normalizeText } from "@/lib/text";
import type { AccessTier, NovelaStatus, Prisma } from "@prisma/client";

/**
 * Fronteira de dados do catálogo.
 *
 * Telas e componentes conversam apenas com este módulo. Nenhum componente
 * conhece Prisma, nomes de coluna ou de onde vem a arte — o que deixa a troca
 * do catálogo de demonstração por conteúdo real restrita a esta camada.
 */

export type NovelaCard = {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  accent: string;
  posterUrl: string;
  heroUrl: string;
  accessTier: AccessTier;
  /** Obra liberada inteira de proposito. */
  openAccess: boolean;
  /** Preco da compra avulsa desta obra, quando foge da tabela. */
  priceCents: number | null;
  status: NovelaStatus;
  year: number;
  ageRating: string;
  rating: number;
  ratingCount: number;
  episodeCount: number;
  genres: { slug: string; name: string }[];
  editorialNote: string | null;
  isNew: boolean;
};

const CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  tagline: true,
  synopsis: true,
  accent: true,
  posterKey: true,
  heroKey: true,
  accessTier: true,
  openAccess: true,
  priceCents: true,
  status: true,
  year: true,
  ageRating: true,
  rating: true,
  ratingCount: true,
  editorialNote: true,
  searchText: true,
  releasedAt: true,
  genres: { select: { genre: { select: { slug: true, name: true } } } },
  _count: { select: { episodes: true } },
} satisfies Prisma.NovelaSelect;

type CardRow = Prisma.NovelaGetPayload<{ select: typeof CARD_SELECT }>;

const NEW_WINDOW_MS = 21 * 86_400_000;

function toCard(row: CardRow): NovelaCard {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    accent: row.accent,
    posterUrl: posterUrl(row.posterKey),
    heroUrl: posterUrl(row.heroKey),
    accessTier: row.accessTier,
    openAccess: row.openAccess,
    priceCents: row.priceCents,
    status: row.status,
    year: row.year,
    ageRating: row.ageRating,
    rating: row.rating,
    ratingCount: row.ratingCount,
    episodeCount: row._count.episodes,
    genres: row.genres.map((link) => link.genre),
    editorialNote: row.editorialNote,
    isNew: Date.now() - row.releasedAt.getTime() < NEW_WINDOW_MS,
  };
}

const PUBLISHED = { status: { not: "COMING_SOON" as const } };

export async function getFeatured(limit = 5): Promise<NovelaCard[]> {
  const rows = await db.novela.findMany({
    where: { isFeatured: true },
    orderBy: { featuredRank: "asc" },
    take: limit,
    select: CARD_SELECT,
  });
  return rows.map(toCard);
}

export async function getNovidades(limit = 12): Promise<NovelaCard[]> {
  const rows = await db.novela.findMany({
    where: PUBLISHED,
    orderBy: { releasedAt: "desc" },
    take: limit,
    select: CARD_SELECT,
  });
  return rows.map(toCard);
}

export async function getPopulares(limit = 12): Promise<NovelaCard[]> {
  const rows = await db.novela.findMany({
    where: PUBLISHED,
    orderBy: [{ viewCount: "desc" }, { rating: "desc" }],
    take: limit,
    select: CARD_SELECT,
  });
  return rows.map(toCard);
}

export async function getCompletas(limit = 12): Promise<NovelaCard[]> {
  const rows = await db.novela.findMany({
    where: { status: "COMPLETED" },
    orderBy: { rating: "desc" },
    take: limit,
    select: CARD_SELECT,
  });
  return rows.map(toCard);
}

export async function getEmBreve(limit = 6): Promise<NovelaCard[]> {
  const rows = await db.novela.findMany({
    where: { status: "COMING_SOON" },
    orderBy: { releasedAt: "asc" },
    take: limit,
    select: CARD_SELECT,
  });
  return rows.map(toCard);
}

/**
 * Obras para quem está começando.
 *
 * Era `getGratuitas`, e filtrava por `accessTier: "FREE"` — o que, com o
 * catálogo inteiro gravado como FREE, devolvia tudo sob o título "estas são
 * grátis". Verdadeiro na Fase 01, falso desde que o paywall passou a valer:
 * nenhuma obra é gratuita por inteiro, só os primeiros episódios de cada uma.
 *
 * Agora devolve as mais vistas, e a tela diz a regra certa. As obras abertas
 * de propósito (`openAccess`) vêm primeiro, quando existirem.
 */
export async function getComecePorAqui(limit = 12): Promise<NovelaCard[]> {
  const rows = await db.novela.findMany({
    where: PUBLISHED,
    orderBy: [{ openAccess: "desc" }, { viewCount: "desc" }],
    take: limit,
    select: CARD_SELECT,
  });
  return rows.map(toCard);
}

/** Recomendação simples e honesta: gêneros preferidos, sem repetir a lista. */
export async function getParaVoce(
  genreIds: string[],
  excludeIds: string[] = [],
  limit = 12,
): Promise<NovelaCard[]> {
  if (genreIds.length === 0) return [];
  const rows = await db.novela.findMany({
    where: {
      ...PUBLISHED,
      id: { notIn: excludeIds.length ? excludeIds : undefined },
      genres: { some: { genreId: { in: genreIds } } },
    },
    orderBy: [{ rating: "desc" }, { viewCount: "desc" }],
    take: limit,
    select: CARD_SELECT,
  });
  return rows.map(toCard);
}

export type GenreSummary = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  accent: string;
  artUrl: string;
  novelaCount: number;
};

export type GenreWithHighlights = GenreSummary & {
  highlights: {
    id: string;
    title: string;
    posterUrl: string;
  }[];
};

const GENRE_SIGNALS: Record<string, readonly string[]> = {
  "romance-proibido": [
    " amor ",
    " amante ",
    " traid",
    " marido ",
    " ex ",
    " engravid",
  ],
  vinganca: [
    " vinganca ",
    " vinga",
    " traid",
    " humilh",
    " rejeita",
    " cruel ",
    " descart",
  ],
  "heranca-e-poder": [
    " herdeir",
    " heranca ",
    " linhagem ",
    " alfa ",
    " rei dragao ",
    " influente ",
    " dono ",
  ],
  "segredos-de-familia": [
    " familia ",
    " filha ",
    " irmao ",
    " bebe ",
    " avo ",
    " marido ",
    " impostora ",
  ],
  "comedia-romantica": [
    " comedia ",
    " divertido",
    " engracad",
    " confusao ",
  ],
  "suspense-passional": [
    " incriminad",
    " desaparecid",
    " misterio",
    " sangue ",
    " abismo ",
    " louco ",
    " verdade enterrada ",
  ],
  "segundo-amor": [
    " recomeco ",
    " primeiro amor acabou ",
    " protetor ",
    " nova vida ",
    " deixa la ir ",
    " ex ",
  ],
  reencontro: [
    " anos depois ",
    " cruza o caminho ",
    " mais uma vez ",
    " reencontro ",
    " reencontra",
  ],
};

function belongsToGenre(
  novela: { title: string; synopsis: string; searchText: string },
  genreSlug: string,
): boolean {
  const signals = GENRE_SIGNALS[genreSlug] ?? [];
  const normalized = novela.searchText.trim()
    ? novela.searchText
    : normalizeText(`${novela.title} ${novela.synopsis}`);
  const document = ` ${normalized} `;
  return signals.some((signal) => document.includes(signal));
}

export async function listGenres(): Promise<GenreSummary[]> {
  const rows = await db.genre.findMany({
    orderBy: { sort: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      tagline: true,
      accent: true,
      _count: { select: { novelas: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    accent: row.accent,
    artUrl: `/api/arte/genero/${row.slug}`,
    novelaCount: row._count.novelas,
  }));
}

/**
 * Gêneros acompanhados das três capas mais populares de cada grupo.
 *
 * A ordenação principal segue visualizações; a nota só desempata. A seleção
 * acontece no repositório para não transportar o catálogo inteiro até a página.
 */
export async function listGenresWithHighlights(): Promise<GenreWithHighlights[]> {
  const [rows, catalog] = await Promise.all([
    db.genre.findMany({
      orderBy: { sort: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        tagline: true,
        accent: true,
        _count: { select: { novelas: true } },
        novelas: {
          orderBy: [
            { novela: { viewCount: "desc" } },
            { novela: { rating: "desc" } },
          ],
          select: {
            novela: {
              select: {
                id: true,
                title: true,
                posterKey: true,
              },
            },
          },
        },
      },
    }),
    db.novela.findMany({
      where: PUBLISHED,
      orderBy: [{ viewCount: "desc" }, { rating: "desc" }],
      select: {
        id: true,
        title: true,
        synopsis: true,
        searchText: true,
        posterKey: true,
      },
    }),
  ]);

  return rows.map((row) => {
    const linked = row.novelas.map(({ novela }) => novela);
    const inferred = linked.length
      ? []
      : catalog.filter((novela) => belongsToGenre(novela, row.slug));
    const references = linked.length ? linked : inferred;

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      tagline: row.tagline,
      accent: row.accent,
      artUrl: `/api/arte/genero/${row.slug}`,
      novelaCount: linked.length ? row._count.novelas : inferred.length,
      highlights: references.slice(0, 3).map((novela) => ({
        id: novela.id,
        title: novela.title,
        posterUrl: posterUrl(novela.posterKey),
      })),
    };
  });
}

// ------------------------------------------------------------------ vitrine

export type NovelaVitrine = NovelaCard & {
  viewCount: number;
  releasedAt: string;
  /** Slugs dos temas: vínculo editorial quando existe, senão lido da sinopse. */
  temas: string[];
};

export type TemaVitrine = {
  slug: string;
  name: string;
  tagline: string;
  accent: string;
  total: number;
};

/** Tema com menos obras que isto vira um filtro que decepciona: fica de fora. */
const MINIMO_POR_TEMA = 8;

/**
 * Catálogo inteiro para a vitrine do Explorar.
 *
 * Vai tudo de uma vez — são algumas centenas de linhas enxutas — porque o
 * filtro acontece no aparelho: trocar de "Em alta" para "Vingança" precisa
 * ser instantâneo e animado, não uma ida ao servidor a cada toque.
 *
 * Obras sem episódio ficam de fora: na vitrine, toda capa tem que abrir algo.
 */
export async function getVitrine(): Promise<{
  novelas: NovelaVitrine[];
  temas: TemaVitrine[];
}> {
  const [rows, genres] = await Promise.all([
    db.novela.findMany({
      where: { ...PUBLISHED, episodes: { some: {} } },
      orderBy: [{ viewCount: "desc" }, { rating: "desc" }, { releasedAt: "desc" }],
      select: { ...CARD_SELECT, viewCount: true },
    }),
    db.genre.findMany({
      orderBy: { sort: "asc" },
      select: { slug: true, name: true, tagline: true, accent: true },
    }),
  ]);

  const novelas = rows.map((row) => {
    const vinculados = row.genres.map((link) => link.genre.slug);
    return {
      ...toCard(row),
      viewCount: row.viewCount,
      releasedAt: row.releasedAt.toISOString(),
      temas: vinculados.length
        ? vinculados
        : genres
            .map((genre) => genre.slug)
            .filter((slug) => belongsToGenre(row, slug)),
    };
  });

  const temas = genres
    .map((genre) => ({
      ...genre,
      total: novelas.filter((novela) => novela.temas.includes(genre.slug))
        .length,
    }))
    .filter((tema) => tema.total >= MINIMO_POR_TEMA)
    .sort((a, b) => b.total - a.total);

  return { novelas, temas };
}

export async function getGenreWithNovelas(slug: string) {
  const genre = await db.genre.findUnique({ where: { slug } });
  if (!genre) return null;
  let rows = await db.novela.findMany({
    where: { genres: { some: { genreId: genre.id } } },
    orderBy: [{ viewCount: "desc" }],
    select: CARD_SELECT,
  });

  // Bibliotecas importadas antes da classificação editorial podem não ter
  // relações de gênero. Nesse caso, a mesma leitura semântica usada nos cards
  // mantém a vitrine e a página de destino consistentes.
  if (rows.length === 0) {
    const catalog = await db.novela.findMany({
      where: PUBLISHED,
      orderBy: [{ viewCount: "desc" }, { rating: "desc" }],
      select: CARD_SELECT,
    });
    rows = catalog.filter((novela) => belongsToGenre(novela, slug));
  }

  return { genre, novelas: rows.map(toCard) };
}

// ------------------------------------------------------------------ detalhe

export type EpisodeItem = {
  id: string;
  number: number;
  seasonNumber: number;
  title: string;
  synopsis: string;
  durationSec: number;
  thumbUrl: string;
  accessTier: AccessTier;
  releasedAt: string;
  locked: boolean;
  lockReason: MotivoBloqueado | null;
  progress: { positionSec: number; percent: number; completed: boolean } | null;
};

export type SeasonItem = {
  id: string;
  number: number;
  title: string;
  synopsis: string | null;
  episodes: EpisodeItem[];
};

export type NovelaDetail = NovelaCard & {
  synopsis: string;
  tags: string[];
  cast: { name: string; role: string }[];
  country: string;
  favoriteCount: number;
  seasons: SeasonItem[];
  totalEpisodes: number;
  isFavorite: boolean;
  /**
   * Trailer já resolvido pela camada de mídia. `null` quando a novela não tem
   * um — e é esse `null` que faz a ação sumir da página, em vez de oferecer um
   * botão que não toca nada.
   *
   * Resolvido aqui porque `trailerKey` é chave opaca: quem renderiza nunca vê
   * caminho de disco, e trocar disco por CDN não mexe na página.
   */
  trailer: MediaSource | null;
  /** Próximo episódio a assistir — alimenta o botão principal. */
  resume: {
    episodeId: string;
    seasonNumber: number;
    episodeNumber: number;
    title: string;
    positionSec: number;
    percent: number;
    label: string;
  } | null;
};

export async function getNovelaDetail(
  slug: string,
  viewer: Viewer | null,
): Promise<NovelaDetail | null> {
  const row = await db.novela.findUnique({
    where: { slug },
    select: {
      ...CARD_SELECT,
      synopsis: true,
      tags: true,
      cast: true,
      country: true,
      favoriteCount: true,
      trailerKey: true,
      seasons: {
        orderBy: { number: "asc" },
        select: {
          id: true,
          number: true,
          title: true,
          synopsis: true,
          episodes: {
            orderBy: { number: "asc" },
            select: {
              id: true,
              number: true,
              title: true,
              synopsis: true,
              durationSec: true,
              thumbKey: true,
              accessTier: true,
              releasedAt: true,
            },
          },
        },
      },
    },
  });
  if (!row) return null;

  const progressRows = viewer
    ? await db.watchProgress.findMany({
        where: { userId: viewer.id, novelaId: row.id },
        select: {
          episodeId: true,
          positionSec: true,
          percent: true,
          completed: true,
          updatedAt: true,
        },
      })
    : [];
  const progressByEpisode = new Map(progressRows.map((p) => [p.episodeId, p]));

  const isFavorite = viewer
    ? Boolean(
        await db.favorite.findUnique({
          where: { userId_novelaId: { userId: viewer.id, novelaId: row.id } },
          select: { id: true },
        }),
      )
    : false;

  const entitlement: Entitlement | null = viewer?.entitlement ?? null;
  let absoluteIndex = 0;
  const flat: EpisodeItem[] = [];

  const seasons: SeasonItem[] = row.seasons.map((season) => ({
    id: season.id,
    number: season.number,
    title: season.title,
    synopsis: season.synopsis,
    episodes: season.episodes.map((episode) => {
      absoluteIndex += 1;
      const decision = canWatchEpisode(
        {
          novelaId: row.id,
          episodeIndex: absoluteIndex,
          openAccess: row.openAccess,
        },
        // A carteira anônima vem do módulo de regra, e não de um literal
        // montado aqui: o literal antigo trazia `freePreviewEpisodes: 2`
        // gravado à mão e teria sobrevivido silenciosamente à mudança para 5.
        entitlement ?? ANONYMOUS_ENTITLEMENT,
        Boolean(viewer),
      );
      const progress = progressByEpisode.get(episode.id);
      const item: EpisodeItem = {
        id: episode.id,
        number: episode.number,
        seasonNumber: season.number,
        title: episode.title,
        synopsis: episode.synopsis,
        durationSec: episode.durationSec,
        thumbUrl: posterUrl(episode.thumbKey),
        accessTier: episode.accessTier,
        releasedAt: episode.releasedAt.toISOString(),
        locked: !decision.allowed,
        lockReason: decision.allowed ? null : decision.reason,
        progress: progress
          ? {
              positionSec: progress.positionSec,
              percent: progress.percent,
              completed: progress.completed,
            }
          : null,
      };
      flat.push(item);
      return item;
    }),
  }));

  // Retomar: episódio começado e não terminado; senão, o primeiro não visto.
  const started = flat
    .filter((e) => e.progress && !e.progress.completed && e.progress.percent > 2)
    .sort((a, b) => (b.progress?.percent ?? 0) - (a.progress?.percent ?? 0))[0];
  const nextUnseen = flat.find((e) => !e.progress?.completed);
  const target = started ?? nextUnseen ?? flat[0] ?? null;

  return {
    ...toCard(row),
    synopsis: row.synopsis,
    tags: row.tags,
    cast: (row.cast as { name: string; role: string }[]) ?? [],
    country: row.country,
    favoriteCount: row.favoriteCount,
    seasons,
    totalEpisodes: flat.length,
    isFavorite,
    // Trailer é opcional em toda a cadeia: sem chave, não há descritor, e a
    // página simplesmente não oferece a ação.
    trailer: row.trailerKey
      ? resolveMedia({
          mediaKey: row.trailerKey,
          // Sem provedor explicito: o trailer mora junto dos episodios, entao
          // vale o provedor padrao do ambiente (MEDIA_PROVIDER).
          format: "mp4",
          // A capa serve de pôster do trailer: é a arte que a novela já tem.
          thumbKey: row.posterKey,
          durationSec: 0,
        })
      : null,
    resume: target
      ? {
          episodeId: target.id,
          seasonNumber: target.seasonNumber,
          episodeNumber: target.number,
          title: target.title,
          positionSec: target.progress?.positionSec ?? 0,
          percent: target.progress?.percent ?? 0,
          label:
            started === target
              ? "Continuar assistindo"
              : target.number === 1 && target.seasonNumber === 1
                ? "Assistir do começo"
                : `Assistir episódio ${target.number}`,
        }
      : null,
  };
}

export type PlayerEpisode = {
  id: string;
  number: number;
  title: string;
  synopsis: string;
  durationSec: number;
  accessTier: AccessTier;
  mediaKey: string;
  mediaProvider: string;
  mediaFormat: string;
  thumbKey: string;
  seasonNumber: number;
  episodeIndex: number;
  novela: {
    id: string;
    slug: string;
    title: string;
    accent: string;
    openAccess: boolean;
  };
};

/**
 * Episódio para o player, com o índice absoluto — necessário para a regra de
 * amostra grátis. Não devolve URL de mídia: isso é responsabilidade da rota
 * que verifica acesso.
 */
export async function getEpisodeForPlayer(
  episodeId: string,
): Promise<PlayerEpisode | null> {
  const episode = await db.episode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      number: true,
      title: true,
      synopsis: true,
      durationSec: true,
      accessTier: true,
      mediaKey: true,
      mediaProvider: true,
      mediaFormat: true,
      thumbKey: true,
      season: { select: { number: true } },
      novela: {
        select: {
          id: true,
          slug: true,
          title: true,
          accent: true,
          openAccess: true,
        },
      },
    },
  });
  if (!episode) return null;

  const earlier = await db.episode.count({
    where: {
      novelaId: episode.novela.id,
      OR: [
        { season: { number: { lt: episode.season.number } } },
        {
          season: { number: episode.season.number },
          number: { lt: episode.number },
        },
      ],
    },
  });

  return {
    id: episode.id,
    number: episode.number,
    title: episode.title,
    synopsis: episode.synopsis,
    durationSec: episode.durationSec,
    accessTier: episode.accessTier,
    mediaKey: episode.mediaKey,
    mediaProvider: episode.mediaProvider,
    mediaFormat: episode.mediaFormat,
    thumbKey: episode.thumbKey,
    seasonNumber: episode.season.number,
    episodeIndex: earlier + 1,
    novela: episode.novela,
  };
}

/** Episódio seguinte, para autoplay e para o botão "próximo". */
export async function getNextEpisode(episodeId: string) {
  const current = await db.episode.findUnique({
    where: { id: episodeId },
    select: {
      number: true,
      novelaId: true,
      season: { select: { number: true } },
    },
  });
  if (!current) return null;

  return db.episode.findFirst({
    where: {
      novelaId: current.novelaId,
      OR: [
        {
          season: { number: current.season.number },
          number: { gt: current.number },
        },
        { season: { number: { gt: current.season.number } } },
      ],
    },
    orderBy: [{ season: { number: "asc" } }, { number: "asc" }],
    select: {
      id: true,
      number: true,
      title: true,
      durationSec: true,
      thumbKey: true,
      season: { select: { number: true } },
    },
  });
}
