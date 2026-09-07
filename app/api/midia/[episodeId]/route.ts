import { NextResponse } from "next/server";

import { getViewer } from "@/lib/auth/session";
import { getEpisodeForPlayer } from "@/lib/repositories/catalog";
import { resolveMedia, type MediaProviderName } from "@/lib/media/resolver";
import { canWatchEpisode, ANONYMOUS_ENTITLEMENT } from "@/lib/access/entitlements";
import { track } from "@/lib/analytics/track";

/**
 * Entrega do descritor de mídia.
 *
 * Este é o portão de acesso do produto: a decisão de quem pode assistir é
 * tomada aqui, no servidor, antes de qualquer URL existir. A interface pode
 * mostrar o cadeado, mas quem impede é esta rota.
 *
 * Quando as URLs passarem a ser assinadas (CDN/objeto), a assinatura entra em
 * `resolveMedia` e nada mais muda.
 */
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
    { accessTier: episode.accessTier, episodeIndex: episode.episodeIndex },
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

    return NextResponse.json(
      {
        erro:
          decision.reason === "needs-account"
            ? "Entre na sua conta para assistir."
            : "Este episódio faz parte do Plantão Premium.",
        motivo: decision.reason,
      },
      { status: decision.reason === "needs-account" ? 401 : 402 },
    );
  }

  const source = resolveMedia({
    mediaKey: episode.mediaKey,
    provider: episode.mediaProvider as MediaProviderName,
    format: episode.mediaFormat,
    thumbKey: episode.thumbKey,
    durationSec: episode.durationSec,
  });

  return NextResponse.json({
    fonte: source,
    acesso: decision.reason,
    episodio: {
      id: episode.id,
      titulo: episode.title,
      numero: episode.number,
      temporada: episode.seasonNumber,
      duracaoSec: episode.durationSec,
    },
  });
}
