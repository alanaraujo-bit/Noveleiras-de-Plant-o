import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { getViewer } from "@/lib/auth/session";
import { getNovelaDetail } from "@/lib/repositories/catalog";
import { comentariosRecentesDaNovela } from "@/lib/repositories/episodio-social";
import { db } from "@/lib/db";
import { TrilhoCapas } from "@/components/novela/cartoes";
import { PainelNovela } from "@/components/novela/PainelNovela";
import { Desbloquear } from "@/components/pagamento/Desbloquear";
import { temNovelaCompleta } from "@/lib/access/entitlements";
import { PLANO_MENSAL, PRECO_AVULSO_CENTS } from "@/lib/pagamentos/planos";
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

  const comentarios = await comentariosRecentesDaNovela(
    novela.id,
    viewer?.id ?? null,
    4,
  );

  return (
    <div className="pb-4">
      <PainelNovela
        novela={novela}
        esconderSpoiler={viewer?.preferences.spoilerGuard ?? true}
      />

      {/*
        O paywall só aparece para quem ainda não tem a obra. A decisão vem de
        `temNovelaCompleta`, o mesmo módulo que a rota de mídia usa — se as
        duas divergissem, a tela ofereceria comprar algo que a pessoa já tem,
        ou esconderia a oferta de quem precisa dela.
      */}
      {viewer &&
      !temNovelaCompleta(novela.id, viewer.entitlement, novela.openAccess) ? (
        <Desbloquear
          novelaId={novela.id}
          novelaSlug={novela.slug}
          novelaTitulo={novela.title}
          precoAvulsoCents={novela.priceCents ?? PRECO_AVULSO_CENTS}
          precoMensalCents={PLANO_MENSAL.precoCents}
          episodiosGratis={viewer.entitlement.freePreviewEpisodes}
          totalEpisodios={novela.totalEpisodes}
        />
      ) : null}

      {comentarios.length > 0 ? (
        <section className="mt-9">
          <TituloSecao
            sobretitulo="O que estão dizendo nos episódios"
          >
            Comentários
          </TituloSecao>
          <div className="space-y-2.5 px-5">
            {comentarios.map((post) => (
              <Link
                key={post.id}
                href={`/assistir/${post.episodio.id}`}
                className="tap surface-card block rounded-card p-3.5"
              >
                <div className="flex items-center gap-2.5">
                  <Avatar
                    nome={post.author.name}
                    seed={post.author.avatarSeed}
                    fotoUrl={post.author.avatarUrl}
                    tamanho={30}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[0.8125rem] font-semibold text-cream-50">
                      {post.author.name}
                    </p>
                    <p className="truncate text-[0.6875rem] text-cream-600">
                      {formatRelative(post.createdAt)}
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
                <p className="mt-2 text-[0.6875rem] font-semibold text-cream-600">
                  T{post.episodio.temporada} · Episódio {post.episodio.numero}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

    </div>
  );
}
