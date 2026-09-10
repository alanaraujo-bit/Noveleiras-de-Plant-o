import "server-only";

import { db } from "@/lib/db";
import { posterUrl } from "@/lib/media/resolver";
import { normalizeText } from "@/lib/text";

/**
 * Busca.
 *
 * Compara contra `Novela.searchText`, que já vem sem acento e em minúsculas —
 * quem digita "coracao" acha "Coração". Cada termo digitado precisa aparecer
 * (E, não OU), e o ranqueamento privilegia quem casa no título.
 */

export type SearchHit = {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  accent: string;
  posterUrl: string;
  year: number;
  accessTier: "FREE" | "PREMIUM";
  openAccess: boolean;
  status: "ONGOING" | "COMPLETED" | "COMING_SOON";
  episodeCount: number;
  rating: number;
  /** Por que este resultado apareceu — mostrado discretamente na lista. */
  matchedOn: "titulo" | "elenco" | "tema";
};

export type SearchOutcome = {
  term: string;
  novelas: SearchHit[];
};

export async function searchCatalog(rawTerm: string): Promise<SearchOutcome> {
  const term = rawTerm.trim();
  const normalized = normalizeText(term);
  if (normalized.length < 2) return { term, novelas: [] };

  const tokens = normalized.split(" ").filter(Boolean).slice(0, 6);

  const rows = await db.novela.findMany({
      where: { AND: tokens.map((token) => ({ searchText: { contains: token } })) },
      orderBy: [{ viewCount: "desc" }],
      take: 30,
      select: {
        id: true,
        slug: true,
        title: true,
        tagline: true,
        accent: true,
        posterKey: true,
        year: true,
        accessTier: true,
        openAccess: true,
        status: true,
        rating: true,
        cast: true,
        _count: { select: { episodes: true } },
      },
    });

  const hits: SearchHit[] = rows.map((row) => {
    const titleNorm = normalizeText(row.title);
    const castNorm = normalizeText(
      ((row.cast as { name: string }[]) ?? []).map((p) => p.name).join(" "),
    );
    const matchedOn = tokens.every((t) => titleNorm.includes(t))
      ? "titulo"
      : tokens.some((t) => castNorm.includes(t))
        ? "elenco"
        : "tema";

    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      tagline: row.tagline,
      accent: row.accent,
      posterUrl: posterUrl(row.posterKey),
      year: row.year,
      accessTier: row.accessTier,
      openAccess: row.openAccess,
      status: row.status,
      episodeCount: row._count.episodes,
      rating: row.rating,
      matchedOn,
    };
  });

  const weight = { titulo: 0, elenco: 1, tema: 2 } as const;
  hits.sort((a, b) => {
    const byMatch = weight[a.matchedOn] - weight[b.matchedOn];
    if (byMatch !== 0) return byMatch;
    const aStarts = normalizeText(a.title).startsWith(tokens[0]) ? 0 : 1;
    const bStarts = normalizeText(b.title).startsWith(tokens[0]) ? 0 : 1;
    return aStarts - bStarts;
  });

  return { term, novelas: hits };
}

/** Registra a busca — base das métricas de intenção do painel futuro. */
export async function recordSearch(input: {
  term: string;
  userId?: string | null;
  sessionId?: string | null;
  resultCount: number;
}) {
  const term = input.term.trim();
  if (term.length < 2) return;
  try {
    await db.searchQuery.create({
      data: {
        term,
        normalized: normalizeText(term),
        userId: input.userId ?? null,
        sessionId: input.sessionId || null,
        resultCount: input.resultCount,
      },
    });
  } catch (error) {
    console.error("[busca] falha ao registrar termo", error);
  }
}

export async function markSearchClick(term: string, novelaId: string) {
  const normalized = normalizeText(term);
  const latest = await db.searchQuery.findFirst({
    where: { normalized },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) return;
  await db.searchQuery.update({
    where: { id: latest.id },
    data: { clickedNovelaId: novelaId },
  });
}

/** Termos que a comunidade mais busca — sugestões honestas, não inventadas. */
export async function getTrendingSearches(limit = 8): Promise<string[]> {
  const rows = await db.searchQuery.groupBy({
    by: ["normalized"],
    where: {
      resultCount: { gt: 0 },
      createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
    },
    _count: { normalized: true },
    orderBy: { _count: { normalized: "desc" } },
    take: limit,
  });
  return rows.map((row) => row.normalized);
}

/** Sugestões de partida quando ninguém buscou nada ainda. */
export async function getSearchSuggestions(limit = 8) {
  const [popular, tags] = await Promise.all([
    db.novela.findMany({
      where: { status: { not: "COMING_SOON" } },
      orderBy: { viewCount: "desc" },
      take: limit,
      select: { slug: true, title: true, accent: true },
    }),
    db.novela.findMany({
      select: { tags: true },
      take: 20,
    }),
  ]);

  const tagCounts = new Map<string, number>();
  for (const row of tags) {
    for (const tag of row.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag);

  return { popular, topTags };
}
