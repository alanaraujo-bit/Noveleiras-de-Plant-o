import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { getViewer } from "@/lib/auth/session";
import { getEpisodeForPlayer, getNextEpisode } from "@/lib/repositories/catalog";
import { posterUrl, resolveMedia, type MediaProviderName } from "@/lib/media/resolver";
import { assinarUrl, segredoDeMidia } from "@/lib/media/assinatura";
import { canWatchEpisode } from "@/lib/access/entitlements";
import { track } from "@/lib/analytics/track";
import { db } from "@/lib/db";
import { Player } from "@/components/player/Player";

type Params = { params: Promise<{ episodeId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { episodeId } = await params;
  const episode = await db.episode.findUnique({
    where: { id: episodeId },
    select: { title: true, novela: { select: { title: true } } },
  });
  if (!episode) return { title: "Episódio não encontrado" };
  return { title: `${episode.title} — ${episode.novela.title}` };
}

export default async function AssistirPage({ params }: Params) {
  const { episodeId } = await params;
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar");

  const episode = await getEpisodeForPlayer(episodeId);
  if (!episode) notFound();

  const [progresso, proximo] = await Promise.all([
    db.watchProgress.findUnique({
      where: { userId_episodeId: { userId: viewer.id, episodeId } },
      select: { positionSec: true, completed: true },
    }),
    getNextEpisode(episodeId),
  ]);

  // A decisão de acesso acontece aqui, no servidor, e a fonte já vai junto com
  // a página. O player não precisa de nenhuma ida à rede para começar: é a
  // diferença entre abrir tocando e abrir girando um carregador.
  const decisao = canWatchEpisode(
    {
      novelaId: episode.novela.id,
      episodeIndex: episode.episodeIndex,
      openAccess: episode.novela.openAccess,
    },
    viewer.entitlement,
    true,
  );

  if (!decisao.allowed) {
    await track({
      type: "PAYWALL_VIEW",
      userId: viewer.id,
      sessionId: viewer.appSessionId,
      novelaId: episode.novela.id,
      episodeId: episode.id,
      payload: { motivo: decisao.reason },
    });
  }

  // A fonte é assinada aqui também, e não só na rota de mídia: esta página
  // entrega o descritor junto com o HTML para o player abrir tocando. Sem
  // assinar nos dois caminhos, um deles serviria um link que o servidor de
  // mídia recusa — e o bug apareceria só em produção, com o segredo ligado.
  const fonte = decisao.allowed
    ? (() => {
        const bruta = resolveMedia({
          mediaKey: episode.mediaKey,
          provider: episode.mediaProvider as MediaProviderName,
          format: episode.mediaFormat,
          thumbKey: episode.thumbKey,
          durationSec: episode.durationSec,
        });
        const assinada = assinarUrl(
          bruta.url,
          episode.mediaKey,
          viewer.id,
          segredoDeMidia(),
        );
        return {
          ...bruta,
          url: assinada.url,
          expiresAt: assinada.expiraEm?.toISOString() ?? null,
        };
      })()
    : null;

  return (
    <Player
      episodio={{
        id: episode.id,
        titulo: episode.title,
        numero: episode.number,
        temporada: episode.seasonNumber,
        duracaoSec: episode.durationSec,
        capaUrl: posterUrl(episode.thumbKey),
        novela: {
          id: episode.novela.id,
          slug: episode.novela.slug,
          titulo: episode.novela.title,
          accent: episode.novela.accent,
        },
      }}
      fonte={fonte}
      bloqueio={decisao.allowed ? null : decisao.reason}
      retomarEm={progresso?.completed ? 0 : (progresso?.positionSec ?? 0)}
      proximo={
        proximo
          ? {
              id: proximo.id,
              titulo: proximo.title,
              numero: proximo.number,
              temporada: proximo.season.number,
              capaUrl: posterUrl(proximo.thumbKey),
            }
          : null
      }
      autoplay={viewer.preferences.autoplayNext}
      economiaDeDados={viewer.preferences.dataSaver}
    />
  );
}
