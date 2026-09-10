"use server";

import { getViewer } from "@/lib/auth/session";
import {
  alternarCurtidaDeComentario,
  alternarCurtidaDeEpisodio,
  apagarComentarioDeEpisodio,
  comentarEmEpisodio,
  contarComentarios,
  contarEnvio,
  listarComentarios,
  listarRespostas,
  type ComentarioDeEpisodio,
} from "@/lib/repositories/episodio-social";
import {
  continuacaoDaNovela,
  filaInicial,
  maisGanchos,
  type LaminaReel,
} from "@/lib/repositories/reel";
import { countEpisodeView } from "@/lib/repositories/progresso";
import { ANONYMOUS_ENTITLEMENT } from "@/lib/access/entitlements";
import { track } from "@/lib/analytics/track";
import { db } from "@/lib/db";

/**
 * Ações do reel.
 *
 * Nenhuma delas chama `revalidatePath`. O reel é uma fila viva na memória do
 * cliente: revalidar a rota remontaria a fila inteira e jogaria a pessoa de
 * volta à primeira lâmina no meio de um toque. O estado visível é atualizado
 * de forma otimista e reconciliado com o número que estas funções devolvem.
 */

type Falha = { ok: false; motivo: "sem-conta" | "invalido" | "nao-encontrado" };

const FALHA_SEM_CONTA: Falha = { ok: false, motivo: "sem-conta" };

// ------------------------------------------------------------- curtir

export async function curtirEpisodio(episodeId: string) {
  const viewer = await getViewer();
  if (!viewer) return FALHA_SEM_CONTA;

  const resultado = await alternarCurtidaDeEpisodio(viewer.id, episodeId);

  const episodio = await db.episode.findUnique({
    where: { id: episodeId },
    select: { novelaId: true },
  });

  await track({
    type: resultado.curtido ? "EPISODE_LIKE" : "EPISODE_UNLIKE",
    userId: viewer.id,
    sessionId: viewer.appSessionId,
    episodeId,
    novelaId: episodio?.novelaId ?? null,
  });

  return { ok: true as const, ...resultado };
}

// ---------------------------------------------------------- comentários

export async function carregarComentarios(episodeId: string) {
  const viewer = await getViewer();
  const comentarios = await listarComentarios(episodeId, viewer?.id ?? null);
  return { ok: true as const, comentarios };
}

/** Respostas de uma conversa. Só sobem quando a pessoa pede para ver. */
export async function carregarRespostas(parentId: string) {
  const viewer = await getViewer();
  const respostas = await listarRespostas(parentId, viewer?.id ?? null);
  return { ok: true as const, respostas };
}

export async function comentarEpisodio(input: {
  episodeId: string;
  body: string;
  spoiler?: boolean;
  /** Comentário sendo respondido. Pode ser uma raiz ou uma resposta. */
  responderA?: string | null;
}): Promise<
  Falha | { ok: true; comentario: ComentarioDeEpisodio; total: number }
> {
  const viewer = await getViewer();
  if (!viewer) return FALHA_SEM_CONTA;

  const texto = input.body.trim();
  if (texto.length < 2) return { ok: false, motivo: "invalido" };

  const comentario = await comentarEmEpisodio({
    userId: viewer.id,
    episodeId: input.episodeId,
    body: texto,
    spoiler: input.spoiler,
    responderA: input.responderA,
  });
  // Nulo significa que o alvo da resposta não existe mais ou é de outro
  // episódio — a conversa mudou embaixo da pessoa enquanto ela escrevia.
  if (!comentario) return { ok: false, motivo: "nao-encontrado" };

  const episodio = await db.episode.findUnique({
    where: { id: input.episodeId },
    select: { novelaId: true },
  });

  await track({
    type: "EPISODE_COMMENT",
    userId: viewer.id,
    sessionId: viewer.appSessionId,
    episodeId: input.episodeId,
    novelaId: episodio?.novelaId ?? null,
    entityType: "episode-comment",
    entityId: comentario.id,
    payload: { resposta: Boolean(input.responderA) },
  });

  return {
    ok: true,
    comentario,
    total: await contarComentarios(input.episodeId),
  };
}

export async function curtirComentario(commentId: string) {
  const viewer = await getViewer();
  if (!viewer) return FALHA_SEM_CONTA;
  const resultado = await alternarCurtidaDeComentario(viewer.id, commentId);
  return resultado
    ? { ok: true as const, ...resultado }
    : ({ ok: false, motivo: "nao-encontrado" } satisfies Falha);
}

export async function apagarComentario(input: {
  commentId: string;
  episodeId: string;
}): Promise<Falha | { ok: true; total: number }> {
  const viewer = await getViewer();
  if (!viewer) return FALHA_SEM_CONTA;
  const apagou = await apagarComentarioDeEpisodio(viewer.id, input.commentId);
  if (!apagou) return { ok: false, motivo: "nao-encontrado" };
  // Apagar uma raiz leva as respostas junto: o total precisa ser recontado, e
  // não estimado a partir do que a tela achava que existia.
  return { ok: true, total: await contarComentarios(input.episodeId) };
}

// -------------------------------------------------------------- enviar

export async function registrarEnvio(episodeId: string) {
  const viewer = await getViewer();
  const episodio = await db.episode.findUnique({
    where: { id: episodeId },
    select: { novelaId: true },
  });
  if (!episodio) return { ok: false, motivo: "nao-encontrado" } satisfies Falha;

  const envios = await contarEnvio(episodeId);
  await track({
    type: "EPISODE_SHARE",
    userId: viewer?.id ?? null,
    sessionId: viewer?.appSessionId ?? null,
    episodeId,
    novelaId: episodio.novelaId,
  });
  return { ok: true as const, envios };
}

// ------------------------------------------------- permanência e emenda

/**
 * Registra que a pessoa realmente ficou nesta lâmina.
 *
 * Chamada só depois do limiar de permanência do cliente. É o que separa
 * "passou o dedo" de "assistiu": sem essa fronteira, uma varredura de dez
 * lâminas viraria dez visualizações, e retenção e abandono no painel
 * deixariam de significar qualquer coisa.
 */
export async function registrarPermanencia(input: {
  episodeId: string;
  novelaId: string;
  origem: "serie" | "gancho";
}) {
  const viewer = await getViewer();

  // O episódio conta sempre; a novela conta uma vez, no primeiro encontro.
  //
  // `countEpisodeView` incrementa os dois contadores de uma vez, e no reel isso
  // seria um laço de retroalimentação: quem assiste cinco episódios seguidos
  // somaria cinco acessos à mesma novela, e `ganchosDeDescoberta` ordena
  // justamente por `viewCount` — a obra subiria no ranking por ter sido vista
  // muito por pouca gente. Um gancho é o primeiro contato com a obra; os
  // episódios de série já estão dentro dela.
  if (input.origem === "gancho") {
    await countEpisodeView(input.episodeId, input.novelaId);
  } else {
    await db.episode
      .update({
        where: { id: input.episodeId },
        data: { viewCount: { increment: 1 } },
      })
      .catch(() => {});
  }

  await track({
    type: "REEL_SLIDE_VIEW",
    userId: viewer?.id ?? null,
    sessionId: viewer?.appSessionId ?? null,
    episodeId: input.episodeId,
    novelaId: input.novelaId,
    payload: { origem: input.origem },
  });
  return { ok: true as const };
}

/** Registra uma lâmina descartada antes do limiar. Alimenta a leitura de gancho. */
export async function registrarDescarte(input: {
  episodeId: string;
  novelaId: string;
  msNaLamina: number;
}) {
  const viewer = await getViewer();
  await track({
    type: "REEL_SLIDE_SKIP",
    userId: viewer?.id ?? null,
    sessionId: viewer?.appSessionId ?? null,
    episodeId: input.episodeId,
    novelaId: input.novelaId,
    valueMs: Math.round(input.msNaLamina),
  });
  return { ok: true as const };
}

/**
 * Costura a continuação de uma novela logo abaixo de um gancho.
 *
 * É a passagem de "descobri" para "estou assistindo", e ela acontece sem tela
 * intermediária: a pessoa fica no gancho, o próximo swipe já é o episódio 2.
 */
export async function emendarSerie(input: {
  novelaId: string;
  depoisDoEpisodioId: string;
  jaNaFila: string[];
}): Promise<{ ok: true; laminas: LaminaReel[] }> {
  const viewer = await getViewer();
  const laminas = await continuacaoDaNovela({
    novelaId: input.novelaId,
    apartirDoEpisodioId: input.depoisDoEpisodioId,
    incluirAtual: false,
    viewerId: viewer?.id ?? null,
    entitlement: viewer?.entitlement ?? ANONYMOUS_ENTITLEMENT,
    excluir: new Set(input.jaNaFila),
  });
  return { ok: true, laminas };
}

/** Próxima página de ganchos, quando a fila está acabando. */
export async function carregarMaisLaminas(novelasNaFila: string[]) {
  const viewer = await getViewer();
  const laminas = await maisGanchos({
    viewerId: viewer?.id ?? null,
    entitlement: viewer?.entitlement ?? ANONYMOUS_ENTITLEMENT,
    generosPreferidos: viewer?.preferences.favoriteGenreIds ?? [],
    novelasNaFila,
  });
  return { ok: true as const, laminas };
}

/**
 * Remonta a fila do zero.
 *
 * Chamada quando a pessoa toca de novo na aba do Plantão já estando no topo.
 * É a mesma montagem da abertura do aplicativo — progresso pendente primeiro,
 * ganchos depois —, então recarregar depois de assistir alguma coisa devolve
 * uma fila que já sabe onde a pessoa parou.
 *
 * O gesto pede um resultado diferente do anterior, e a fila só muda quando
 * algo mudou de verdade: o que foi assistido, o que entrou no catálogo. Não há
 * embaralhamento artificial para simular novidade — inventar variação faria a
 * ordem deixar de ser explicável, que é justamente o que a descoberta aqui não
 * pode perder.
 */
export async function recarregarFila() {
  const viewer = await getViewer();
  if (!viewer) return FALHA_SEM_CONTA;

  const { laminas, retomando } = await filaInicial({
    viewerId: viewer.id,
    entitlement: viewer.entitlement,
    generosPreferidos: viewer.preferences.favoriteGenreIds,
  });

  await track({
    type: "REEL_OPEN",
    userId: viewer.id,
    sessionId: viewer.appSessionId,
    payload: { laminas: laminas.length, retomando, origem: "recarga" },
  });

  return { ok: true as const, laminas };
}
