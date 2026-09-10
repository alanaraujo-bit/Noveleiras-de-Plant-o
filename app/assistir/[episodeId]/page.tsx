import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { db } from "@/lib/db";

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
  const episode = await db.episode.findUnique({
    where: { id: episodeId },
    select: { id: true },
  });
  if (!episode) notFound();

  redirect(`/plantao?episodio=${encodeURIComponent(episode.id)}`);
}
