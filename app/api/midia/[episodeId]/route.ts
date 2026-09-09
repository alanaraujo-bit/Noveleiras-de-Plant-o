import { NextResponse } from "next/server";

import {
  ANONYMOUS_ENTITLEMENT,
  canWatchEpisode,
} from "@/lib/access/entitlements";
import { track } from "@/lib/analytics/track";
import { assinarUrl, segredoDeMidia } from "@/lib/media/assinatura";
import { resolveMedia, type MediaProviderName } from "@/lib/media/resolver";
import { getViewer } from "@/lib/auth/session";
import { getEpisodeForPlayer } from "@/lib/repositories/catalog";

/**
 * Entrega do descritor de mídia.
 *
 * Este é o portão de acesso do produto: a decisão de quem pode assistir é
 * tomada aqui, no servidor, antes de qualquer URL existir. A interface pode
 * mostrar o cadeado, mas quem impede é esta rota.
 *
 * O que mudou na fase comercial: a URL devolvida agora é **assinada e tem
 * prazo**. Antes, autorizar uma vez entregava um link permanente — o paywall
 * valia para o primeiro pedido e para mais nenhum, porque o link copiado
 * seguia funcionando e podia ser repassado.
 *
 * `force-dynamic` é obrigatório. Sem isso o Next pode servir a mesma resposta
 * em cache para pessoas diferentes, e um assinante acabaria financiando o
 * acesso de todo mundo.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await params;
  const [viewer, episode] = await Promise.all([
    getViewer(),
    getEpisodeForPlayer(episodeId),
  ]);

  if (!episode) {
    return NextResponse.json(
      { erro: "Episódio não encontrado." },
      { status: 404 },
    );
  }

  const decision = canWatchEpisode(
    {
      novelaId: episode.novela.id,
      episodeIndex: episode.episodeIndex,
      openAccess: episode.novela.openAccess,
    },
    viewer?.entitlement ?? ANONYMOUS_ENTITLEMENT,
    Boolean(viewer),
  );

  if (!decision.allowed) {
    await track({
      type: "PAYWALL_VIEW",
      userId: viewer?.id ?? null,
      sessionId: viewer?.appSessionId ?? null,
      novelaId: episode.novela.id,
      episodeId: episode.id,
      payload: { motivo: decision.reason },
    });

    const precisaConta = decision.reason === "precisa-conta";

    return NextResponse.json(
      {
        erro: precisaConta
          ? "Entre na sua conta para assistir."
          : "Este episódio faz parte do catálogo pago.",
        motivo: decision.reason,
        // A interface usa isto para escolher entre "assine" e "compre esta
        // novela" sem precisar recalcular a regra do lado do cliente.
        novelaSlug: episode.novela.slug,
      },
      { status: precisaConta ? 401 : 402 },
    );
  }

  const source = resolveMedia({
    mediaKey: episode.mediaKey,
    provider: episode.mediaProvider as MediaProviderName,
    format: episode.mediaFormat,
    thumbKey: episode.thumbKey,
    durationSec: episode.durationSec,
  });

  // Assina depois de autorizar, nunca antes: o link só existe para quem já
  // passou pela decisão acima.
  const assinado = assinarUrl(
    source.url,
    episode.mediaKey,
    viewer?.id ?? "anonimo",
    segredoDeMidia(),
  );

  return NextResponse.json(
    {
      fonte: {
        ...source,
        url: assinado.url,
        expiresAt: assinado.expiraEm?.toISOString() ?? null,
      },
      acesso: decision.reason,
      episodio: {
        id: episode.id,
        titulo: episode.title,
        numero: episode.number,
        temporada: episode.seasonNumber,
        duracaoSec: episode.durationSec,
      },
    },
    {
      // Nenhuma camada intermediária pode guardar um link assinado: ele é
      // pessoal e tem prazo.
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
