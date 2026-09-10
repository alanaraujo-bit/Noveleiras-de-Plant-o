import "server-only";

import { db } from "@/lib/db";
import { avatarUrl } from "@/lib/media/avatars";

/**
 * Curtida, comentário e envio de um episódio.
 *
 * Os contadores em `Episode` são espelho, não fonte: `EpisodeLike` e
 * `EpisodeComment` guardam os fatos. Toda escrita ajusta os dois dentro da
 * mesma transação — do contrário um comentário apagado deixaria o número
 * subido para sempre, e o painel não teria como reconstruir a diferença.
 */

export type AutorDeComentario = {
  id: string;
  name: string;
  handle: string;
  avatarSeed: string;
  avatarUrl: string | null;
};

export type ComentarioDeEpisodio = {
  id: string;
  body: string;
  spoiler: boolean;
  createdAt: string;
  isOwn: boolean;
  author: AutorDeComentario;
};

const AUTOR_SELECT = {
  id: true,
  name: true,
  handle: true,
  avatarSeed: true,
  avatarKey: true,
} as const;

function paraAutor(u: {
  id: string;
  name: string;
  handle: string;
  avatarSeed: string;
  avatarKey: string | null;
}): AutorDeComentario {
  return {
    id: u.id,
    name: u.name,
    handle: u.handle,
    avatarSeed: u.avatarSeed,
    avatarUrl: avatarUrl(u.id, u.avatarKey),
  };
}

export async function listarComentarios(
  episodeId: string,
  viewerId: string | null,
  take = 40,
): Promise<ComentarioDeEpisodio[]> {
  const linhas = await db.episodeComment.findMany({
    where: { episodeId, hiddenAt: null },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      body: true,
      spoiler: true,
      createdAt: true,
      userId: true,
      user: { select: AUTOR_SELECT },
    },
  });

  return linhas.map((linha) => ({
    id: linha.id,
    body: linha.body,
    spoiler: linha.spoiler,
    createdAt: linha.createdAt.toISOString(),
    isOwn: linha.userId === viewerId,
    author: paraAutor(linha.user),
  }));
}

/**
 * Curte ou descurte. A chave composta faz o banco decidir se já existe — não
 * há leitura-antes-de-escrita, então dois toques rápidos não viram duas linhas.
 */
export async function alternarCurtidaDeEpisodio(
  userId: string,
  episodeId: string,
): Promise<{ curtido: boolean; curtidas: number }> {
  const existente = await db.episodeLike.findUnique({
    where: { episodeId_userId: { episodeId, userId } },
    select: { userId: true },
  });

  const [, episodio] = existente
    ? await db.$transaction([
        db.episodeLike.delete({
          where: { episodeId_userId: { episodeId, userId } },
        }),
        db.episode.update({
          where: { id: episodeId },
          data: { likeCount: { decrement: 1 } },
          select: { likeCount: true },
        }),
      ])
    : await db.$transaction([
        db.episodeLike.create({ data: { episodeId, userId } }),
        db.episode.update({
          where: { id: episodeId },
          data: { likeCount: { increment: 1 } },
          select: { likeCount: true },
        }),
      ]);

  return { curtido: !existente, curtidas: Math.max(0, episodio.likeCount) };
}

export async function comentarEmEpisodio(input: {
  userId: string;
  episodeId: string;
  body: string;
  spoiler?: boolean;
}): Promise<ComentarioDeEpisodio> {
  const [comentario] = await db.$transaction([
    db.episodeComment.create({
      data: {
        episodeId: input.episodeId,
        userId: input.userId,
        body: input.body.trim().slice(0, 600),
        spoiler: input.spoiler ?? false,
      },
      select: {
        id: true,
        body: true,
        spoiler: true,
        createdAt: true,
        user: { select: AUTOR_SELECT },
      },
    }),
    db.episode.update({
      where: { id: input.episodeId },
      data: { commentCount: { increment: 1 } },
      select: { id: true },
    }),
  ]);

  return {
    id: comentario.id,
    body: comentario.body,
    spoiler: comentario.spoiler,
    createdAt: comentario.createdAt.toISOString(),
    isOwn: true,
    author: paraAutor(comentario.user),
  };
}

/** Apagar o próprio comentário. A checagem de dono vive no `where`, não num `if`. */
export async function apagarComentarioDeEpisodio(
  userId: string,
  commentId: string,
): Promise<boolean> {
  const comentario = await db.episodeComment.findFirst({
    where: { id: commentId, userId, hiddenAt: null },
    select: { id: true, episodeId: true },
  });
  if (!comentario) return false;

  await db.$transaction([
    db.episodeComment.delete({ where: { id: comentario.id } }),
    db.episode.update({
      where: { id: comentario.episodeId },
      data: { commentCount: { decrement: 1 } },
      select: { id: true },
    }),
  ]);
  return true;
}

/**
 * Conta um envio.
 *
 * O navegador não avisa se a pessoa concluiu o compartilhamento — a Web Share
 * API resolve mesmo quando o alvo é cancelado. O número, portanto, mede
 * *intenção de enviar*, e a interface nunca o apresenta como alcance.
 */
export async function contarEnvio(episodeId: string): Promise<number> {
  const episodio = await db.episode.update({
    where: { id: episodeId },
    data: { shareCount: { increment: 1 } },
    select: { shareCount: true },
  });
  return episodio.shareCount;
}
