import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { getViewer } from "@/lib/auth/session";
import { getEpisodeForPlayer, getNextEpisode } from "@/lib/repositories/catalog";
import { posterUrl } from "@/lib/media/resolver";
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
    />
  );
}
