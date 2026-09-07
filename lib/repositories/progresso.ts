import "server-only";

import { db } from "@/lib/db";
import { posterUrl } from "@/lib/media/resolver";

/**
 * Progresso, "continuar assistindo", histórico e lista.
 *
 * `WatchProgress` é a fonte única: a Home, o histórico e o tempo assistido do
 * painel futuro leem daqui. Nada é recalculado no cliente.
 */

export type ContinueItem = {
  novelaId: string;
  slug: string;
  title: string;
  accent: string;
  posterUrl: string;
  episodeId: string;
  episodeNumber: number;
  seasonNumber: number;
  episodeTitle: string;
  thumbUrl: string;
  positionSec: number;
  durationSec: number;
  percent: number;
  updatedAt: string;
  /** Nesta novela, quantos episódios já foram concluídos. */
  completedCount: number;
  totalEpisodes: number;
};

/**
 * Uma linha por novela: o episódio mais recentemente tocado. Se aquele
 * episódio já terminou, aponta para o próximo — é isso que a pessoa espera
 * ao voltar ao app.
 */
export async function getContinueWatching(
  userId: string,
  limit = 10,
): Promise<ContinueItem[]> {
  const recent = await db.watchProgress.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: {
      novelaId: true,
      episodeId: true,
      positionSec: true,
      durationSec: true,
      percent: true,
      completed: true,
      updatedAt: true,
      episode: {
        select: {
          number: true,
          title: true,
          thumbKey: true,
          durationSec: true,
          season: { select: { number: true } },
        },
      },
      novela: {
        select: {
          slug: true,
          title: true,
          accent: true,
          posterKey: true,
          _count: { select: { episodes: true } },
        },
      },
    },
  });

  const seen = new Set<string>();
  const latestPerNovela = recent.filter((row) => {
    if (seen.has(row.novelaId)) return false;
    seen.add(row.novelaId);
    return true;
  });

  const novelaIds = latestPerNovela.map((row) => row.novelaId);
  const completedCounts = novelaIds.length
    ? await db.watchProgress.groupBy({
        by: ["novelaId"],
        where: { userId, novelaId: { in: novelaIds }, completed: true },
        _count: { novelaId: true },
      })
    : [];
  const completedByNovela = new Map(
    completedCounts.map((row) => [row.novelaId, row._count.novelaId]),
  );

  const items: ContinueItem[] = [];

  for (const row of latestPerNovela) {
    let episodeId = row.episodeId;
    let episodeNumber = row.episode.number;
    let seasonNumber = row.episode.season.number;
    let episodeTitle = row.episode.title;
    let thumbKey = row.episode.thumbKey;
    let positionSec = row.positionSec;
    let durationSec = row.durationSec || row.episode.durationSec;
    let percent = row.percent;

    if (row.completed) {
      const next = await db.episode.findFirst({
        where: {
          novelaId: row.novelaId,
          OR: [
            {
              season: { number: seasonNumber },
              number: { gt: episodeNumber },
            },
            { season: { number: { gt: seasonNumber } } },
          ],
        },
        orderBy: [{ season: { number: "asc" } }, { number: "asc" }],
        select: {
          id: true,
          number: true,
          title: true,
          thumbKey: true,
          durationSec: true,
          season: { select: { number: true } },
        },
      });
      // Novela terminada por completo sai de "continuar assistindo".
      if (!next) continue;
      episodeId = next.id;
      episodeNumber = next.number;
      seasonNumber = next.season.number;
      episodeTitle = next.title;
      thumbKey = next.thumbKey;
      positionSec = 0;
      durationSec = next.durationSec;
      percent = 0;
    }

    items.push({
      novelaId: row.novelaId,
      slug: row.novela.slug,
      title: row.novela.title,
      accent: row.novela.accent,
      posterUrl: posterUrl(row.novela.posterKey),
      episodeId,
      episodeNumber,
      seasonNumber,
      episodeTitle,
      thumbUrl: posterUrl(thumbKey),
      positionSec,
      durationSec,
      percent,
      updatedAt: row.updatedAt.toISOString(),
      completedCount: completedByNovela.get(row.novelaId) ?? 0,
      totalEpisodes: row.novela._count.episodes,
    });

    if (items.length >= limit) break;
  }

  return items;
}

export type HistoryItem = {
  episodeId: string;
  episodeTitle: string;
  episodeNumber: number;
  seasonNumber: number;
  thumbUrl: string;
  novelaSlug: string;
  novelaTitle: string;
  accent: string;
  percent: number;
  positionSec: number;
  durationSec: number;
  completed: boolean;
  watchedAt: string;
};

export async function getHistory(
  userId: string,
  limit = 60,
): Promise<HistoryItem[]> {
  const rows = await db.watchProgress.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      episodeId: true,
      positionSec: true,
      durationSec: true,
      percent: true,
      completed: true,
      updatedAt: true,
      episode: {
        select: {
          title: true,
          number: true,
          thumbKey: true,
          season: { select: { number: true } },
        },
      },
      novela: { select: { slug: true, title: true, accent: true } },
    },
  });

  return rows.map((row) => ({
    episodeId: row.episodeId,
    episodeTitle: row.episode.title,
    episodeNumber: row.episode.number,
    seasonNumber: row.episode.season.number,
    thumbUrl: posterUrl(row.episode.thumbKey),
    novelaSlug: row.novela.slug,
    novelaTitle: row.novela.title,
    accent: row.novela.accent,
    percent: row.percent,
    positionSec: row.positionSec,
    durationSec: row.durationSec,
    completed: row.completed,
    watchedAt: row.updatedAt.toISOString(),
  }));
}

export type SaveProgressInput = {
  userId: string;
  episodeId: string;
  positionSec: number;
  durationSec: number;
  /** Tempo de tela desde o último envio. Somado, não substituído. */
  deltaMs: number;
  completed?: boolean;
  abandoned?: boolean;
};

/**
 * Grava progresso de forma incremental. `watchedMs` acumula tempo real de
 * exibição (base de "tempo assistido" no painel); `positionSec` é a posição
 * para retomar.
 */
export async function saveProgress(input: SaveProgressInput) {
  const durationSec = Math.max(1, Math.round(input.durationSec));
  const positionSec = Math.min(
    durationSec,
    Math.max(0, Math.round(input.positionSec)),
  );
  const percent = Math.min(100, Math.round((positionSec / durationSec) * 100));
  const completed = input.completed ?? percent >= 95;
  const deltaMs = Math.max(0, Math.min(input.deltaMs, 5 * 60_000));

  const episode = await db.episode.findUnique({
    where: { id: input.episodeId },
    select: { novelaId: true },
  });
  if (!episode) return null;

  const saved = await db.watchProgress.upsert({
    where: {
      userId_episodeId: { userId: input.userId, episodeId: input.episodeId },
    },
    create: {
      userId: input.userId,
      episodeId: input.episodeId,
      novelaId: episode.novelaId,
      positionSec,
      durationSec,
      percent,
      completed,
      watchedMs: deltaMs,
      abandonedAt: input.abandoned ? positionSec : null,
    },
    update: {
      positionSec,
      durationSec,
      percent,
      completed: completed ? true : undefined,
      watchedMs: { increment: deltaMs },
      abandonedAt: input.abandoned ? positionSec : null,
    },
    select: { percent: true, completed: true, positionSec: true },
  });

  if (deltaMs > 0) {
    // Agregados do catálogo: alimentam "populares" e o painel sem varrer o log.
    await db.$transaction([
      db.episode.update({
        where: { id: input.episodeId },
        data: { watchedMs: { increment: BigInt(deltaMs) } },
      }),
      db.novela.update({
        where: { id: episode.novelaId },
        data: { watchedMs: { increment: BigInt(deltaMs) } },
      }),
    ]);
  }

  return saved;
}

/** Registra a primeira exibição de um episódio (contagem de acessos). */
export async function countEpisodeView(episodeId: string, novelaId: string) {
  await db.$transaction([
    db.episode.update({
      where: { id: episodeId },
      data: { viewCount: { increment: 1 } },
    }),
    db.novela.update({
      where: { id: novelaId },
      data: { viewCount: { increment: 1 } },
    }),
  ]);
}

// ------------------------------------------------------------------- lista

export async function listFavorites(userId: string) {
  const rows = await db.favorite.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      novela: {
        select: {
          id: true,
          slug: true,
          title: true,
          tagline: true,
          accent: true,
          posterKey: true,
          heroKey: true,
          accessTier: true,
          status: true,
          year: true,
          ageRating: true,
          rating: true,
          ratingCount: true,
          editorialNote: true,
          releasedAt: true,
          genres: { select: { genre: { select: { slug: true, name: true } } } },
          _count: { select: { episodes: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    addedAt: row.createdAt.toISOString(),
    novela: {
      id: row.novela.id,
      slug: row.novela.slug,
      title: row.novela.title,
      tagline: row.novela.tagline,
      accent: row.novela.accent,
      posterUrl: posterUrl(row.novela.posterKey),
      heroUrl: posterUrl(row.novela.heroKey),
      accessTier: row.novela.accessTier,
      status: row.novela.status,
      year: row.novela.year,
      ageRating: row.novela.ageRating,
      rating: row.novela.rating,
      ratingCount: row.novela.ratingCount,
      episodeCount: row.novela._count.episodes,
      genres: row.novela.genres.map((link) => link.genre),
      editorialNote: row.novela.editorialNote,
      isNew: Date.now() - row.novela.releasedAt.getTime() < 21 * 86_400_000,
    },
  }));
}

export async function toggleFavorite(userId: string, novelaId: string) {
  const existing = await db.favorite.findUnique({
    where: { userId_novelaId: { userId, novelaId } },
    select: { id: true },
  });

  if (existing) {
    await db.$transaction([
      db.favorite.delete({ where: { id: existing.id } }),
      db.novela.update({
        where: { id: novelaId },
        data: { favoriteCount: { decrement: 1 } },
      }),
    ]);
    return { favorite: false };
  }

  await db.$transaction([
    db.favorite.create({ data: { userId, novelaId } }),
    db.novela.update({
      where: { id: novelaId },
      data: { favoriteCount: { increment: 1 } },
    }),
  ]);
  return { favorite: true };
}

/** Resumo de consumo mostrado no perfil. */
export async function getViewerStats(userId: string) {
  const [progress, favorites, distinctNovelas] = await Promise.all([
    db.watchProgress.aggregate({
      where: { userId },
      _sum: { watchedMs: true },
      _count: { _all: true },
    }),
    db.favorite.count({ where: { userId } }),
    db.watchProgress.groupBy({ by: ["novelaId"], where: { userId } }),
  ]);
  const completed = await db.watchProgress.count({
    where: { userId, completed: true },
  });

  return {
    watchedMinutes: Math.round((progress._sum.watchedMs ?? 0) / 60_000),
    episodesStarted: progress._count._all,
    episodesCompleted: completed,
    novelasStarted: distinctNovelas.length,
    favorites,
  };
}
