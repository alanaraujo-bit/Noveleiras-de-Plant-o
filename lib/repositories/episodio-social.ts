import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { avatarUrl } from "@/lib/media/avatars";

/**
 * Conversa e curtida de um episódio.
 *
 * Duas regras estruturais explicam o formato:
 *
 * 1. **A árvore é achatada na escrita.** Responder a uma resposta grava
 *    `parentId` da raiz, nunca do alvo. A interface desenha exatamente dois
 *    níveis — como Instagram e TikTok — e só isso mantém a conversa legível
 *    numa folha de celular. Deixar a profundidade crescer empurraria o
 *    problema para a leitura, onde ele não tem solução boa.
 *
 * 2. **Nada de contador denormalizado aqui.** Curtidas e respostas saem de
 *    `_count` sobre a relação. Apagar uma raiz remove a árvore em cascata, e
 *    qualquer espelho que tentasse acompanhar isso ficaria acima do fato — já
 *    aconteceu duas vezes neste projeto. Contando a relação, a divergência é
 *    impossível por construção.
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
  curtidas: number;
  curtido: boolean;
  /** Respostas nesta conversa. Sempre zero num item que já é resposta. */
  respostas: number;
  /** Nome de quem esta resposta responde — só quando não é a própria raiz. */
  respondendoA: string | null;
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

/**
 * Seleção compartilhada entre raízes e respostas.
 *
 * `likes` vem filtrado pelo espectador em vez de carregado inteiro: a pergunta
 * é "eu curti?", e trazer mil linhas para responder um booleano seria absurdo.
 * É o mesmo padrão que `lib/repositories/feed.ts` já usa para publicações.
 */
function selecaoDeComentario(viewerId: string | null) {
  return {
    id: true,
    body: true,
    spoiler: true,
    createdAt: true,
    userId: true,
    parentId: true,
    replyToId: true,
    user: { select: AUTOR_SELECT },
    replyTo: { select: { user: { select: { name: true } } } },
    _count: {
      select: {
        likes: true,
        replies: { where: { hiddenAt: null } },
      },
    },
    likes: viewerId
      ? ({ where: { userId: viewerId }, select: { userId: true } } as const)
      : (false as const),
  };
}

type LinhaDeComentario = {
  id: string;
  body: string;
  spoiler: boolean;
  createdAt: Date;
  userId: string;
  parentId: string | null;
  replyToId: string | null;
  user: Parameters<typeof paraAutor>[0];
  replyTo: { user: { name: string } } | null;
  _count: { likes: number; replies: number };
  likes?: { userId: string }[] | false;
};

function paraComentario(
  linha: LinhaDeComentario,
  viewerId: string | null,
): ComentarioDeEpisodio {
  return {
    id: linha.id,
    body: linha.body,
    spoiler: linha.spoiler,
    createdAt: linha.createdAt.toISOString(),
    isOwn: linha.userId === viewerId,
    author: paraAutor(linha.user),
    curtidas: linha._count.likes,
    curtido: Array.isArray(linha.likes) && linha.likes.length > 0,
    respostas: linha._count.replies,
    // A menção só existe quando a resposta se dirige a outra resposta. Numa
    // resposta à própria raiz ela seria ruído: o recuo já diz a quem se
    // responde, e repetir o nome do dono da conversa em toda linha polui uma
    // coluna que já é estreita.
    respondendoA:
      linha.replyToId && linha.replyToId !== linha.parentId
        ? (linha.replyTo?.user.name ?? null)
        : null,
  };
}

/**
 * Raízes de conversa de um episódio, da mais recente para a mais antiga.
 *
 * Ordenar por curtidas pareceria mais "social" e brigaria com a escrita: um
 * comentário recém-publicado aparece no topo de forma otimista, e numa lista
 * ordenada por popularidade ele saltaria de lugar assim que o servidor
 * respondesse. Tempo é a ordem que a pessoa consegue prever.
 */
export async function listarComentarios(
  episodeId: string,
  viewerId: string | null,
  take = 30,
): Promise<ComentarioDeEpisodio[]> {
  const linhas = await db.episodeComment.findMany({
    where: { episodeId, parentId: null, hiddenAt: null },
    orderBy: { createdAt: "desc" },
    take,
    select: selecaoDeComentario(viewerId),
  });
  return linhas.map((l) => paraComentario(l as LinhaDeComentario, viewerId));
}

/** Respostas de uma conversa, em ordem de leitura. */
export async function listarRespostas(
  parentId: string,
  viewerId: string | null,
  take = 50,
): Promise<ComentarioDeEpisodio[]> {
  const linhas = await db.episodeComment.findMany({
    where: { parentId, hiddenAt: null },
    orderBy: { createdAt: "asc" },
    take,
    select: selecaoDeComentario(viewerId),
  });
  return linhas.map((l) => paraComentario(l as LinhaDeComentario, viewerId));
}

/**
 * Publica um comentário ou uma resposta.
 *
 * `responderA` aponta para o comentário que a pessoa tocou, que pode ser uma
 * raiz ou uma resposta. O achatamento acontece aqui, nestas duas linhas: a
 * conversa recebe sempre a raiz como `parentId`, e `replyToId` guarda quem
 * está sendo respondido de verdade. É o que impede a profundidade de crescer.
 */
export async function comentarEmEpisodio(input: {
  userId: string;
  episodeId: string;
  body: string;
  spoiler?: boolean;
  responderA?: string | null;
}): Promise<ComentarioDeEpisodio | null> {
  let parentId: string | null = null;
  let replyToId: string | null = null;

  if (input.responderA) {
    const alvo = await db.episodeComment.findFirst({
      // O episódio entra no `where`, e não num `if`: sem isso, um id de
      // comentário de outra novela penduraria a resposta na conversa errada.
      where: { id: input.responderA, episodeId: input.episodeId, hiddenAt: null },
      select: { id: true, parentId: true },
    });
    if (!alvo) return null;
    parentId = alvo.parentId ?? alvo.id;
    replyToId = alvo.id;
  }

  const criado = await db.episodeComment.create({
    data: {
      episodeId: input.episodeId,
      userId: input.userId,
      body: input.body.trim().slice(0, 600),
      spoiler: input.spoiler ?? false,
      parentId,
      replyToId,
    },
    select: selecaoDeComentario(input.userId),
  });

  return paraComentario(criado as LinhaDeComentario, input.userId);
}

/**
 * Curte ou descurte um comentário.
 *
 * A chave composta faz o banco decidir se a linha já existe, então dois toques
 * rápidos não viram duas curtidas.
 */
export async function alternarCurtidaDeComentario(
  userId: string,
  commentId: string,
): Promise<{ curtido: boolean; curtidas: number } | null> {
  const comentario = await db.episodeComment.findFirst({
    where: { id: commentId, hiddenAt: null },
    select: { id: true },
  });
  if (!comentario) return null;

  const existente = await db.episodeCommentLike.findUnique({
    where: { commentId_userId: { commentId, userId } },
    select: { userId: true },
  });

  if (existente) {
    await db.episodeCommentLike.delete({
      where: { commentId_userId: { commentId, userId } },
    });
  } else {
    await db.episodeCommentLike.create({ data: { commentId, userId } });
  }

  return {
    curtido: !existente,
    curtidas: await db.episodeCommentLike.count({ where: { commentId } }),
  };
}

/**
 * Apaga o próprio comentário.
 *
 * A checagem de dono vive no `where`, não num `if`: quem não é dono não
 * encontra a linha, em vez de encontrá-la e ser barrado depois. Apagar uma
 * raiz leva a conversa junto, por cascata — e é por isso que não existe
 * contador para acertar aqui.
 */
export async function apagarComentarioDeEpisodio(
  userId: string,
  commentId: string,
): Promise<boolean> {
  const comentario = await db.episodeComment.findFirst({
    where: { id: commentId, userId, hiddenAt: null },
    select: { id: true },
  });
  if (!comentario) return false;
  await db.episodeComment.delete({ where: { id: comentario.id } });
  return true;
}

/**
 * Curte ou descurte o episódio.
 *
 * Aqui o espelho continua existindo (`Episode.likeCount`), porque a lâmina
 * mostra o número no primeiro quadro e não há cascata que possa desalinhá-lo:
 * uma curtida é uma linha, sem filhos.
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

/**
 * Conta as conversas visíveis de um episódio.
 *
 * Respostas contam, como em qualquer rede — mas as de uma raiz oculta não,
 * porque elas saíram de vista junto com ela.
 */
// Função, e não constante: o Prisma exige `OR` como array mutável, e um objeto
// literal compartilhado (ainda mais com `as const`) é recusado pelo tipo. Cada
// chamada devolve o seu.
export function filtroDeComentariosVisiveis(): Prisma.EpisodeCommentWhereInput {
  return {
    hiddenAt: null,
    OR: [{ parentId: null }, { parent: { hiddenAt: null } }],
  };
}

export async function contarComentarios(episodeId: string): Promise<number> {
  return db.episodeComment.count({
    where: { episodeId, ...filtroDeComentariosVisiveis() },
  });
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
