"use server";

import { revalidatePath } from "next/cache";

import { getViewer } from "@/lib/auth/session";
import { toggleFavorite } from "@/lib/repositories/progresso";
import { markSearchClick, recordSearch } from "@/lib/repositories/busca";
import { track } from "@/lib/analytics/track";
import { db } from "@/lib/db";

/** Ações do catálogo e da comunidade. Toda escrita passa por aqui. */

export async function alternarFavorito(novelaId: string, slug: string) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const, motivo: "sem-conta" as const };

  const resultado = await toggleFavorite(viewer.id, novelaId);
  await track({
    type: resultado.favorite ? "FAVORITE_ADD" : "FAVORITE_REMOVE",
    userId: viewer.id,
    sessionId: viewer.appSessionId,
    novelaId,
  });

  revalidatePath(`/novela/${slug}`);
  revalidatePath("/minha-lista");
  return { ok: true as const, favorito: resultado.favorite };
}

export async function registrarBusca(termo: string, resultados: number) {
  const viewer = await getViewer();
  await recordSearch({
    term: termo,
    userId: viewer?.id ?? null,
    sessionId: viewer?.appSessionId ?? null,
    resultCount: resultados,
  });
  await track({
    type: "SEARCH",
    userId: viewer?.id ?? null,
    sessionId: viewer?.appSessionId ?? null,
    payload: { termo, resultados },
  });
}

export async function registrarCliqueBusca(termo: string, novelaId: string) {
  await markSearchClick(termo, novelaId);
}



/** Contabiliza a abertura de uma novela. Chamado uma vez por visita à página. */
export async function registrarAcessoNovela(novelaId: string) {
  const viewer = await getViewer();
  await db.novela
    .update({ where: { id: novelaId }, data: { viewCount: { increment: 1 } } })
    .catch(() => {});
  await track({
    type: "NOVELA_VIEW",
    userId: viewer?.id ?? null,
    sessionId: viewer?.appSessionId ?? null,
    novelaId,
  });
}
