import "server-only";

import { db } from "@/lib/db";
import { posterUrl } from "@/lib/media/resolver";

/**
 * Feed da comunidade.
 *
 * Modelado como publicação ancorada em novela/episódio, com curtidas e
 * comentários já normalizados — a evolução para seguir pessoas, notificações e
 * moderação entra sem migração destrutiva (`hiddenAt` já existe).
 */

export type FeedAuthor = {
  id: string;
  name: string;
  handle: string;
  avatarSeed: string;
};

export type FeedComment = {
  id: string;
  body: string;
  createdAt: string;
  author: FeedAuthor;
};

export type FeedPost = {
  id: string;
  kind: "THOUGHT" | "REVIEW" | "THEORY";
  body: string;
  spoiler: boolean;
  rating: number | null;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  likedByViewer: boolean;
  isOwn: boolean;
  author: FeedAuthor;
  novela: {
    slug: string;
    title: string;
    accent: string;
    posterUrl: string;
  } | null;
  comments: FeedComment[];
};

const AUTHOR_SELECT = {
  id: true,
  name: true,
  handle: true,
  avatarSeed: true,
} as const;

export async function getFeed(
  viewerId: string | null,
  options: { novelaId?: string; take?: number } = {},
): Promise<FeedPost[]> {
  const rows = await db.post.findMany({
    where: {
      hiddenAt: null,
      novelaId: options.novelaId,
    },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 30,
    select: {
      id: true,
      kind: true,
      body: true,
      spoiler: true,
      rating: true,
      likeCount: true,
      commentCount: true,
      createdAt: true,
      userId: true,
      user: { select: AUTHOR_SELECT },
      novela: {
        select: { slug: true, title: true, accent: true, posterKey: true },
      },
      likes: viewerId
        ? { where: { userId: viewerId }, select: { userId: true } }
        : false,
      comments: {
        where: { hiddenAt: null },
        orderBy: { createdAt: "asc" },
        take: 3,
        select: {
          id: true,
          body: true,
          createdAt: true,
          user: { select: AUTHOR_SELECT },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    body: row.body,
    spoiler: row.spoiler,
    rating: row.rating,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    createdAt: row.createdAt.toISOString(),
    likedByViewer: Array.isArray(row.likes) ? row.likes.length > 0 : false,
    isOwn: row.userId === viewerId,
    author: row.user,
    novela: row.novela
      ? {
          slug: row.novela.slug,
          title: row.novela.title,
          accent: row.novela.accent,
          posterUrl: posterUrl(row.novela.posterKey),
        }
      : null,
    comments: row.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      author: comment.user,
    })),
  }));
}

export async function createPost(input: {
  userId: string;
  body: string;
  novelaId?: string | null;
  kind?: "THOUGHT" | "REVIEW" | "THEORY";
  spoiler?: boolean;
  rating?: number | null;
}) {
  return db.post.create({
    data: {
      userId: input.userId,
      body: input.body.trim().slice(0, 900),
      novelaId: input.novelaId ?? null,
      kind: input.kind ?? "THOUGHT",
      spoiler: input.spoiler ?? false,
      rating: input.rating ?? null,
    },
    select: { id: true, novelaId: true },
  });
}

export async function toggleLike(userId: string, postId: string) {
  const existing = await db.postLike.findUnique({
    where: { postId_userId: { postId, userId } },
    select: { postId: true },
  });

  if (existing) {
    await db.$transaction([
      db.postLike.delete({ where: { postId_userId: { postId, userId } } }),
      db.post.update({
        where: { id: postId },
        data: { likeCount: { decrement: 1 } },
      }),
    ]);
    return { liked: false };
  }

  await db.$transaction([
    db.postLike.create({ data: { postId, userId } }),
    db.post.update({
      where: { id: postId },
      data: { likeCount: { increment: 1 } },
    }),
  ]);
  return { liked: true };
}

export async function addComment(input: {
  userId: string;
  postId: string;
  body: string;
}) {
  const [comment] = await db.$transaction([
    db.comment.create({
      data: {
        userId: input.userId,
        postId: input.postId,
        body: input.body.trim().slice(0, 500),
      },
      select: {
        id: true,
        body: true,
        createdAt: true,
        user: { select: AUTHOR_SELECT },
      },
    }),
    db.post.update({
      where: { id: input.postId },
      data: { commentCount: { increment: 1 } },
    }),
  ]);
  return comment;
}

/** Novelas que a pessoa pode marcar ao publicar. */
export async function getPostableNovelas(userId: string | null) {
  if (!userId) {
    return db.novela.findMany({
      where: { status: { not: "COMING_SOON" } },
      orderBy: { viewCount: "desc" },
      take: 12,
      select: { id: true, title: true, accent: true },
    });
  }

  const watched = await db.watchProgress.findMany({
    where: { userId },
    distinct: ["novelaId"],
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: { novela: { select: { id: true, title: true, accent: true } } },
  });
  const fromHistory = watched.map((row) => row.novela);

  const extras = await db.novela.findMany({
    where: {
      status: { not: "COMING_SOON" },
      id: { notIn: fromHistory.map((n) => n.id) },
    },
    orderBy: { viewCount: "desc" },
    take: 8,
    select: { id: true, title: true, accent: true },
  });

  return [...fromHistory, ...extras];
}
