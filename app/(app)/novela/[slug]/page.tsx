import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { getViewer } from "@/lib/auth/session";
import { getNovelaDetail, getParaVoce } from "@/lib/repositories/catalog";
import { getFeed } from "@/lib/repositories/feed";
import { db } from "@/lib/db";
import { TrilhoCapas } from "@/components/novela/cartoes";
import { PainelNovela } from "@/components/novela/PainelNovela";
import { Avatar, TituloSecao } from "@/components/ui/primitivos";
import { IconeSeta } from "@/components/ui/icones";
import { formatRelative } from "@/lib/format";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const novela = await db.novela.findUnique({
    where: { slug },
    select: { title: true, tagline: true },
  });
  if (!novela) return { title: "Novela não encontrada" };
  return { title: novela.title, description: novela.tagline };
}

export default async function NovelaPage({ params }: Params) {
  const { slug } = await params;
  const viewer = await getViewer();
  const novela = await getNovelaDetail(slug, viewer);
  if (!novela) notFound();

  const generoIds = await db.novelaGenre.findMany({
    where: { novelaId: novela.id },
    select: { genreId: true },
  });

  const [semelhantes, comentarios] = await Promise.all([
    getParaVoce(
      generoIds.map((row) => row.genreId),
      [novela.id],
      8,
    ),
    getFeed(viewer?.id ?? null, { novelaId: novela.id, take: 4 }),
  ]);

  return (
    <div className="pb-4">
      <PainelNovela
        novela={novela}
        esconderSpoiler={viewer?.preferences.spoilerGuard ?? true}
      />

      {comentarios.length > 0 ? (
        <section className="mt-9">
          <TituloSecao
            sobretitulo="O que estão dizendo"
            acao={
              <Link
                href="/feed"
                className="tap inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-cream-400"
              >
                Plantão
                <IconeSeta tamanho={14} />
              </Link>
            }
          >
            Comentários
          </TituloSecao>
          <div className="space-y-2.5 px-5">
            {comentarios.map((post) => (
              <article key={post.id} className="surface-card rounded-card p-3.5">
                <div className="flex items-center gap-2.5">
                  <Avatar
                    nome={post.author.name}
                    seed={post.author.avatarSeed}
                    tamanho={30}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[0.8125rem] font-semibold text-cream-50">
                      {post.author.name}
                    </p>
                    <p className="truncate text-[0.6875rem] text-cream-600">
                      @{post.author.handle} · {formatRelative(post.createdAt)}
                    </p>
                  </div>
                </div>
                <p
                  className={`selectable mt-2.5 text-[0.875rem] leading-relaxed text-cream-200 ${
                    post.spoiler && (viewer?.preferences.spoilerGuard ?? true)
                      ? "blur-[5px] select-none"
                      : ""
                  }`}
                >
                  {post.body}
                </p>
                {post.spoiler && (viewer?.preferences.spoilerGuard ?? true) ? (
                  <p className="mt-1.5 text-[0.75rem] font-semibold text-gold-400">
                    Escondido pelo seu antispoiler
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {semelhantes.length > 0 ? (
        <section className="mt-9">
          <TituloSecao sobretitulo="Se você gostou desta">
            Continue por aqui
          </TituloSecao>
          <TrilhoCapas novelas={semelhantes} />
        </section>
      ) : null}
    </div>
  );
}
